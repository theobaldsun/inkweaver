/**
 * 逻辑调用持久化入口：只保存可信准备层已校验的调用，不执行工具、不授予权限。
 * 同一用户写入先取得用户行锁，与 Run Writer 和清理保持一致锁顺序。
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { writeToolAttempt } from './tool-attempt.writer';
import { transitionToolCall } from './tool-call-lifecycle';
import { lockAgentOwner } from '../agent-data.cleanup';
import { appendAgentEvent } from '../agent-event.writer';
import { AgentRun } from '../entity/agent-run.entity';
import { AgentToolAttempt } from '../entity/agent-tool-attempt.entity';
import { AgentToolCall } from '../entity/agent-tool-call.entity';

import type { ToolCallEvent, ToolCallLifecycle } from './tool-call-lifecycle';
import type { ToolCallPreparationResult } from './tool-call-preparer';
import type { ToolOrigin } from './tool-definition';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/** 参数快照与来源均由可信装配/准备层提供，不能直接接受 HTTP 或模型指定此结构。 */
export interface CreateToolCallRecord {
  /** 所属 Run UUID。 */
  runId: string;
  /** Run 内逻辑键，重投同一调用时复用。 */
  callKey: string;
  /** 已通过输入 Schema 与策略预检查的结果，不是执行许可。 */
  prepared: Extract<ToolCallPreparationResult, { status: 'prepared' }>;
  /** 与此次准备使用的工具版本对应的可信来源快照。 */
  origin: ToolOrigin;
}

/** 不回显参数，也不区分其他用户的 Run 是否存在。 */
export class ToolCallStoreError extends Error {
  constructor(readonly code: 'INVALID_TOOL_CALL_RECORD' | 'TOOL_CALL_KEY_CONFLICT' | 'RUN_NOT_ACCEPTING_CALLS' | 'TOOL_CALL_UPDATE_CONFLICT') {
    super(code);
    this.name = 'ToolCallStoreError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ToolCallStore {
  /** 可组合到上层事务的 manager；由 Graph、保存和维护链调用，状态、Attempt 与事件同事务保存。 */
  constructor(private readonly manager: EntityManager) {}

  /**
   * 创建工具调用记录（幂等：同键同内容返回已有，同键不同内容拒绝）。
   *
   * 流程：
   * 1. 参数结构校验（UUID、字段类型、长度、origin 合法性）。
   * 2. 构造 identity 对象（用于幂等比较）。
   * 3. 事务内：
   *    - 查 Run 存在性；
   *    - 查是否已有同 callKey 记录 → 有则 deepEqual 比较；
   *    - 无则检查 Run 必须为 RUNNING → INSERT 新记录（status='PREPARED'）→ 写事件。
   *
   * 约束：新记录只允许在 RUNNING 的 Run 中创建；返回已有记录时调用方不能重新执行终态调用。
   */
  async create(userId: string, request: CreateToolCallRecord): Promise<AgentToolCall> {
    // 约定输入来自 JSON 解码/可信服务；这里不处理外来进程内 Proxy 或插件对象。
    const snapshot = structuredClone(request);
    const { call, requiresConfirmation } = snapshot.prepared;

    // ── 阶段一：参数结构校验 ──
    if (!uuid.test(userId) || !uuid.test(snapshot.runId) || call.userId !== userId
      || snapshot.prepared.status !== 'prepared' || typeof requiresConfirmation !== 'boolean'
      || typeof snapshot.callKey !== 'string' || !snapshot.callKey.trim() || [...snapshot.callKey].length > 128
      || typeof call.name !== 'string' || !call.name.trim() || typeof call.version !== 'string' || !call.version.trim()
      || !call.input || typeof call.input !== 'object' || Array.isArray(call.input)
      || !['builtin', 'mcp'].includes(snapshot.origin.kind)
      || (snapshot.origin.kind === 'mcp' && (typeof snapshot.origin.connectionId !== 'string' || !snapshot.origin.connectionId.trim()))) {
      throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
    }

    // 构造 identity 对象：用于幂等比较（同 callKey 时内容必须完全一致）。
    const identity = { toolName: call.name, toolVersion: call.version, originKind: snapshot.origin.kind,
      connectionId: snapshot.origin.kind === 'mcp' ? snapshot.origin.connectionId : null,
      input: call.input as Record<string, unknown>, requiresConfirmation };

    // ── 阶段二：事务内持久化 ──
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);

      // 查 Run 存在性：Run 不存在则不能创建工具调用。
      const run = await manager.getRepository(AgentRun).findOneBy({ id: snapshot.runId, userId });
      if (!run) throw new ToolCallStoreError('RUN_NOT_ACCEPTING_CALLS');

      const repository = manager.getRepository(AgentToolCall);

      // 查是否已有同 callKey 记录：幂等入口——同键同内容直接返回，同键不同内容拒绝。
      const existing = await repository.findOneBy({ runId: run.id, userId, callKey: snapshot.callKey });
      if (existing) {
        const saved = { toolName: existing.toolName, toolVersion: existing.toolVersion, originKind: existing.originKind,
          connectionId: existing.connectionId, input: existing.input, requiresConfirmation: existing.requiresConfirmation };
        // 同 callKey 但内容不同 → 参数在并发/重试中发生了变化，不能覆盖已确认参数。
        if (!isDeepStrictEqual(saved, identity)) throw new ToolCallStoreError('TOOL_CALL_KEY_CONFLICT');
        return existing;
      }

      // 新记录：Run 必须为 RUNNING，终态 Run 不再接受新工具调用。
      if (run.status !== 'RUNNING') throw new ToolCallStoreError('RUN_NOT_ACCEPTING_CALLS');

      // 插入新记录：初始状态 PREPARED，副作用 none，尝试次数 0，版本号 0。
      const result = await repository.createQueryBuilder().insert().into(AgentToolCall).values({
        id: randomUUID(), runId: run.id, userId, callKey: snapshot.callKey, ...identity,
        // TypeORM 将 JSON 对象误建模为递归更新表达式；此处传已校验 JSON 值，由 jsonb 驱动序列化。
        input: identity.input as QueryDeepPartialEntity<AgentToolCall>['input'],
        status: 'PREPARED', sideEffect: 'none', attemptCount: 0, cancelRequested: false, revision: 0,
      }).returning('*').execute();
      const record = repository.create(result.raw[0] as AgentToolCall);

      // 写事件：TOOL_CALL_CREATED，供 SSE 推送和外部观察。
      await appendAgentEvent(manager, { id: run.id, userId }, { schemaVersion: 1, type: 'TOOL_CALL_CREATED',
        payload: { callId: record.id, revision: 0, state: { status: record.status, sideEffect: record.sideEffect,
          attemptCount: record.attemptCount, requiresConfirmation: record.requiresConfirmation, cancelRequested: record.cancelRequested } } });
      return record;
    });
  }

  /** 查询只返回当前用户指定 Run 下的调用；无权和不存在统一返回 null。 */
  async get(userId: string, runId: string, callId: string): Promise<AgentToolCall | null> {
    if (![userId, runId, callId].every((id) => uuid.test(id))) throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
    return this.manager.getRepository(AgentToolCall).findOneBy({ id: callId, runId, userId });
  }

  /** 读取指定执行代次；启动后用返回的 attemptCount 查询，避免误取后续重试。 */
  async getAttempt(userId: string, runId: string, callId: string, attemptNumber: number): Promise<AgentToolAttempt | null> {
    if (![userId, runId, callId].every((id) => typeof id === 'string' && uuid.test(id))
      || !Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 2147483647) throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
    return this.manager.getRepository(AgentToolAttempt).findOneBy({ userId, runId, callId, attemptNumber });
  }

  /**
   * 工具调用状态机 transitions：按事件驱动纯函数计算下一状态，CAS 条件更新入库。
   *
   * 设计边界：
   * - 本方法只负责"状态转换落库"，不验证确认令牌、执行权、预算或执行事实——这些由调用方（ToolAuthorization / ToolExecutor）保证。
   * - 状态机输入（旧状态）取自数据库，不接受调用方提供；输出（新状态）由 `transitionToolCall` 纯函数计算。
   * - CAS（Compare-And-Swap）：UPDATE 条件包含 `status = :旧状态 AND revision = :旧版本`，只有匹配时才更新，防并发覆盖。
   *
   * @param expectedRevision 调用方看到的当前版本号；与数据库 revision 不匹配时拒绝更新（乐观锁）。
   * @param event 状态机事件类型（RESOURCES_APPROVED / CONFIRMED / START / SUCCEEDED / FAILED 等）。
   * @param expectedAttemptId 结果/重试事件须携带本轮 attemptId，确保写到正确的执行代次。
   */
  async transition(userId: string, runId: string, callId: string, expectedRevision: number, event: ToolCallEvent, expectedAttemptId?: string): Promise<AgentToolCall> {
    if (![userId, runId, callId].every((id) => typeof id === 'string' && uuid.test(id))
      || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) {
      throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
    }
    if (expectedAttemptId !== undefined && !uuid.test(expectedAttemptId)) throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
    const cause = structuredClone(event);

    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);

      // 查 Run 状态：终态 Run 不接受新事件；START 事件只能在 RUNNING 时触发。
      const run = await manager.getRepository(AgentRun).findOneBy({ id: runId, userId });
      if (!run || !['CREATED', 'QUEUED', 'RUNNING', 'WAITING_CONFIRMATION'].includes(run.status)
        || (cause.type === 'START' && run.status !== 'RUNNING')) {
        throw new ToolCallStoreError('RUN_NOT_ACCEPTING_CALLS');
      }

      const repository = manager.getRepository(AgentToolCall);

      // 查当前记录 + 乐观锁校验：revision 必须等于 expectedRevision。
      const current = await repository.findOneBy({ id: callId, runId, userId });
      if (!current || current.revision !== expectedRevision) throw new ToolCallStoreError('TOOL_CALL_UPDATE_CONFLICT');

      // 构造旧状态对象，交给纯函数状态机计算下一状态。
      const state: ToolCallLifecycle = { status: current.status, sideEffect: current.sideEffect,
        attemptCount: current.attemptCount, requiresConfirmation: current.requiresConfirmation, cancelRequested: current.cancelRequested };
      const next = transitionToolCall(state, cause);

      // 领域模型使用 JS 安全整数，数据库 integer 范围更小（2147483647），提交前溢出检查。
      if (next.attemptCount > 2147483647) throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');

      // CAS 条件 UPDATE：只有 status 和 revision 同时匹配时才更新；否则说明并发冲突。
      const result = await repository.createQueryBuilder().update(AgentToolCall).set({
        status: next.status, sideEffect: next.sideEffect, attemptCount: next.attemptCount,
        cancelRequested: next.cancelRequested,
        // RETRY_SCHEDULED 的具体截止时间由执行控制层在同一上层事务写入；离开 RETRY_WAIT 必须清理旧截止时间。
        retryNotBefore: next.status === 'RETRY_WAIT' ? current.retryNotBefore : null,
        // revision 原子递增：SQL 表达式而非 JS 计算，避免竞态。
        revision: () => '"revision" + 1', updatedAt: () => 'clock_timestamp()',
      }).where('"id" = :callId AND "runId" = :runId AND "userId" = :userId AND "status" = :status AND "revision" = :revision',
        { callId, runId, userId, status: current.status, revision: expectedRevision }).returning('*').execute();
      if (result.affected !== 1) throw new ToolCallStoreError('TOOL_CALL_UPDATE_CONFLICT');

      const record = repository.create(result.raw[0] as AgentToolCall);

      // 写入执行代次记录（AgentToolAttempt）：记录本次事件对应的尝试详情。
      await writeToolAttempt(manager, record, cause, expectedAttemptId);

      // 写事件：TOOL_CALL_STATE_CHANGED，供 SSE 推送和外部观察。
      await appendAgentEvent(manager, { id: runId, userId }, { schemaVersion: 1, type: 'TOOL_CALL_STATE_CHANGED',
        payload: { callId, revision: record.revision, from: state, to: next, cause } });
      return record;
    });
  }
}
