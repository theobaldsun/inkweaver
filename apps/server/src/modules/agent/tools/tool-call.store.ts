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
   * 同键同内容返回已有记录（保留当前状态）；同键不同内容拒绝，不覆盖已确认参数。
   * 新记录只允许在 RUNNING 的 Run 中创建。返回已有记录不允许重新执行终态调用。
   */
  async create(userId: string, request: CreateToolCallRecord): Promise<AgentToolCall> {
    // 约定输入来自 JSON 解码/可信服务；这里不处理外来进程内 Proxy 或插件对象。
    const snapshot = structuredClone(request);
    const { call, requiresConfirmation } = snapshot.prepared;
    if (!uuid.test(userId) || !uuid.test(snapshot.runId) || call.userId !== userId
      || snapshot.prepared.status !== 'prepared' || typeof requiresConfirmation !== 'boolean'
      || typeof snapshot.callKey !== 'string' || !snapshot.callKey.trim() || [...snapshot.callKey].length > 128
      || typeof call.name !== 'string' || !call.name.trim() || typeof call.version !== 'string' || !call.version.trim()
      || !call.input || typeof call.input !== 'object' || Array.isArray(call.input)
      || !['builtin', 'mcp'].includes(snapshot.origin.kind)
      || (snapshot.origin.kind === 'mcp' && (typeof snapshot.origin.connectionId !== 'string' || !snapshot.origin.connectionId.trim()))) {
      throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
    }
    const identity = { toolName: call.name, toolVersion: call.version, originKind: snapshot.origin.kind,
      connectionId: snapshot.origin.kind === 'mcp' ? snapshot.origin.connectionId : null,
      input: call.input as Record<string, unknown>, requiresConfirmation };
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await manager.getRepository(AgentRun).findOneBy({ id: snapshot.runId, userId });
      if (!run) throw new ToolCallStoreError('RUN_NOT_ACCEPTING_CALLS');
      const repository = manager.getRepository(AgentToolCall);
      const existing = await repository.findOneBy({ runId: run.id, userId, callKey: snapshot.callKey });
      if (existing) {
        const saved = { toolName: existing.toolName, toolVersion: existing.toolVersion, originKind: existing.originKind,
          connectionId: existing.connectionId, input: existing.input, requiresConfirmation: existing.requiresConfirmation };
        if (!isDeepStrictEqual(saved, identity)) throw new ToolCallStoreError('TOOL_CALL_KEY_CONFLICT');
        return existing;
      }
      if (run.status !== 'RUNNING') throw new ToolCallStoreError('RUN_NOT_ACCEPTING_CALLS');
      const result = await repository.createQueryBuilder().insert().into(AgentToolCall).values({
        id: randomUUID(), runId: run.id, userId, callKey: snapshot.callKey, ...identity,
        // TypeORM 将 JSON 对象误建模为递归更新表达式；此处传已校验 JSON 值，由 jsonb 驱动序列化。
        input: identity.input as QueryDeepPartialEntity<AgentToolCall>['input'],
        status: 'PREPARED', sideEffect: 'none', attemptCount: 0, cancelRequested: false, revision: 0,
      }).returning('*').execute();
      const record = repository.create(result.raw[0] as AgentToolCall);
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
   * 仅供可信上层提交已核验事件；本方法不验证确认令牌、执行权、预算或执行事实。
   * 结果/重试事件须携带本轮 expectedAttemptId；START 自动创建独立代次，取消意图不结束尝试。
   * 生命周期值取自数据库，不接受调用方提供副作用/尝试次数作为旧状态。
   * 用户锁协调清理和 Run 更新，条件 UPDATE 防止旧版本或绕过该锁的写入被覆盖。
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
      const run = await manager.getRepository(AgentRun).findOneBy({ id: runId, userId });
      if (!run || !['CREATED', 'QUEUED', 'RUNNING', 'WAITING_CONFIRMATION'].includes(run.status)
        || (cause.type === 'START' && run.status !== 'RUNNING')) {
        throw new ToolCallStoreError('RUN_NOT_ACCEPTING_CALLS');
      }
      const repository = manager.getRepository(AgentToolCall);
      const current = await repository.findOneBy({ id: callId, runId, userId });
      if (!current || current.revision !== expectedRevision) throw new ToolCallStoreError('TOOL_CALL_UPDATE_CONFLICT');
      const state: ToolCallLifecycle = { status: current.status, sideEffect: current.sideEffect,
        attemptCount: current.attemptCount, requiresConfirmation: current.requiresConfirmation, cancelRequested: current.cancelRequested };
      const next = transitionToolCall(state, cause);
      // 领域模型使用 JS 安全整数，数据库 integer 的范围更小，提交前明确检查。
      if (next.attemptCount > 2147483647) throw new ToolCallStoreError('INVALID_TOOL_CALL_RECORD');
      const result = await repository.createQueryBuilder().update(AgentToolCall).set({
        status: next.status, sideEffect: next.sideEffect, attemptCount: next.attemptCount,
        cancelRequested: next.cancelRequested,
        // RETRY_SCHEDULED 的具体截止时间由执行控制层在同一上层事务写入；离开 RETRY_WAIT 必须清理旧截止时间。
        retryNotBefore: next.status === 'RETRY_WAIT' ? current.retryNotBefore : null,
        revision: () => '"revision" + 1', updatedAt: () => 'clock_timestamp()',
      }).where('"id" = :callId AND "runId" = :runId AND "userId" = :userId AND "status" = :status AND "revision" = :revision',
        { callId, runId, userId, status: current.status, revision: expectedRevision }).returning('*').execute();
      if (result.affected !== 1) throw new ToolCallStoreError('TOOL_CALL_UPDATE_CONFLICT');
      const record = repository.create(result.raw[0] as AgentToolCall);
      await writeToolAttempt(manager, record, cause, expectedAttemptId);
      await appendAgentEvent(manager, { id: runId, userId }, { schemaVersion: 1, type: 'TOOL_CALL_STATE_CHANGED',
        payload: { callId, revision: record.revision, from: state, to: next, cause } });
      return record;
    });
  }
}
