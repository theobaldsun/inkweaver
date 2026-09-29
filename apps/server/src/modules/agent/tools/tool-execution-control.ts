/** 工具调用级取消与过期只读尝试恢复；不重放工具，不将未知写操作当作只读。 */
import { randomUUID } from 'node:crypto';

import { isToolCallTerminal } from './tool-call-lifecycle';
import { ToolCallStore } from './tool-call.store';
import { defaultToolExecutionRegistry } from './tool-execution-registry';
import { advanceDueRetry, ToolRetryPolicy } from './tool-retry';
import { lockAgentOwner } from '../agent-data.cleanup';

import type { ToolCatalog } from './tool-catalog';
import type { ToolExecutionRegistry } from './tool-execution-registry';
import type { AgentToolCall } from '../entity/agent-tool-call.entity';
import type { EntityManager } from 'typeorm';

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface ToolExecutionControlOptions {
  /** 恢复 Worker UUID；只用于领取过期记录，不向用户或模型暴露。 */
  workerId?: string;
  /** 与执行器共享的进程内取消桥接。 */
  registry?: ToolExecutionRegistry;
  /** 当前可信目录；缺失时恢复只收尾，不主动安排安全重试。 */
  catalog?: ToolCatalog;
  /** 单逻辑调用最大尝试数，与执行器保持一致。 */
  maxAttempts?: number;
  /** 恢复后首次重试退避。 */
  retryBaseDelayMs?: number;
  /** 恢复重试退避上限。 */
  retryMaxDelayMs?: number;
}

export class ToolExecutionControl {
  private readonly workerId: string;
  private readonly registry: ToolExecutionRegistry;
  private readonly catalog?: ToolCatalog;
  /** 与执行器共用同一退避语义；恢复后的重试次数与等待时长只在此处裁决。 */
  private readonly retry: ToolRetryPolicy;

  /** 认证后的服务端入口注入；userId 不得取自模型或未认证请求正文。 */
  constructor(private readonly manager: EntityManager, options: ToolExecutionControlOptions = {}) {
    this.workerId = options.workerId ?? randomUUID();
    this.registry = options.registry ?? defaultToolExecutionRegistry;
    this.catalog = options.catalog;
    // 重试边界由共享策略校验，避免与执行器的退避语义漂移。
    this.retry = new ToolRetryPolicy(options);
    if (!uuid.test(this.workerId)) throw new Error('INVALID_CONTROL_OPTIONS');
  }

  /** 取消幂等：执行前直接取消，执行中持久化意图并尽快通知本进程执行器。 */
  async cancel(userId: string, runId: string, callId: string): Promise<AgentToolCall> {
    const call = await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const store = new ToolCallStore(manager);
      const current = await store.get(userId, runId, callId);
      if (!current) throw new Error('CALL_NOT_FOUND');
      if (isToolCallTerminal(current.status)) return current;
      if (current.cancelRequested) return current;
      return store.transition(userId, runId, callId, current.revision, { type: 'CANCEL_REQUESTED' });
    });
    // 这只是低延迟通知；跨进程或注册窗口竞争由数据库标记 + 心跳/调用边界复核兜底。
    if (call.cancelRequested && !isToolCallTerminal(call.status)) this.registry.cancel(userId, runId, callId);
    return call;
  }

  /**
   * 单批恢复当前用户的过期尝试；候选查询不持锁，逐条事务重验，多个调度者可并发调用。
   * 只处理执行器持久化标明 builtin_read 的记录；历史未知/写操作不自动结算或重放。
   * 返回本批成功收尾的 attemptId；未到期、已被其他恢复 Worker 处理的记录跳过。
   */
  async recoverExpired(userId: string, limit = 50): Promise<string[]> {
    if (!uuid.test(userId) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_RECOVERY_REQUEST');
    const candidates: { id: string; runId: string; callId: string }[] = await this.manager.query(`SELECT a.id,a."runId",a."callId" FROM agent_tool_attempts a
      JOIN agent_budget_reservations b ON b."attemptId"=a.id
      WHERE a."userId"=$1 AND a.status='STARTED' AND a."leaseExpiresAt"<=clock_timestamp()
        AND b.status='RESERVED' AND b."executionKind"='builtin_read'
      ORDER BY a."leaseExpiresAt",a.id LIMIT $2`, [userId, limit]);
    const recovered: string[] = [];
    for (const candidate of candidates) {
      // 若旧执行器仍在本进程，先发取消信号；数据库领取仍是最终并发裁决。
      this.registry.cancel(userId, candidate.runId, candidate.callId);
      const changed = await this.manager.transaction('READ COMMITTED', async (manager) => {
        await lockAgentOwner(manager, userId);
        const rows = await manager.query(`WITH updated AS (
          UPDATE agent_tool_attempts a SET "leaseOwner"=$3,
            "leaseExpiresAt"=clock_timestamp() + interval '30 seconds'
          FROM agent_budget_reservations b
          WHERE a.id=$1 AND a."userId"=$2 AND a.status='STARTED' AND a."leaseExpiresAt"<=clock_timestamp()
            AND b."attemptId"=a.id AND b.status='RESERVED' AND b."executionKind"='builtin_read'
          RETURNING a.*
        ) SELECT * FROM updated`, [candidate.id, userId, this.workerId]);
        const attempt = rows[0];
        if (!attempt) return false;
        const store = new ToolCallStore(manager);
        const call = await store.get(userId, attempt.runId, attempt.callId);
        if (!call || call.status !== 'EXECUTING' || call.attemptCount !== attempt.attemptNumber) throw new Error('RECOVERY_STATE_CONFLICT');
        const notInvoked = attempt.invocationStartedAt === null;
        const retryable = !call.cancelRequested && this.retry.canRetry(call.attemptCount) && this.canSafelyRetry(call);
        let updated = call;
        if (retryable && !notInvoked) {
          // 失联发生在真实调用边界之后，先记录结果未知；只读工具再由可信定义证明整体副作用为 none。
          updated = await store.transition(userId, call.runId, call.id, updated.revision, { type: 'OUTCOME_UNKNOWN' }, attempt.id);
        }
        if (retryable) {
          await store.transition(userId, call.runId, call.id, updated.revision,
            { type: 'RETRY_SCHEDULED', sideEffect: 'none', guarantee: 'safe' }, attempt.id);
          // 截止时间与本轮恢复收尾同一事务提交；写不进去说明状态已被其他路径改变。
          await this.retry.schedule(manager, { userId, runId: call.runId, callId: call.id }, call.attemptCount);
        } else {
          const event = call.cancelRequested && notInvoked
            ? { type: 'STOPPED_WITHOUT_EFFECT' as const }
            : { type: 'FAILED' as const, sideEffect: 'none' as const };
          await store.transition(userId, call.runId, call.id, updated.revision, event, attempt.id);
        }
        const errorCode = call.cancelRequested
          ? notInvoked ? 'READ_CANCELLED_BEFORE_INVOKE' : 'READ_CANCEL_INTERRUPTED'
          : retryable ? notInvoked ? 'READ_NOT_INVOKED_RETRY' : 'READ_OUTCOME_RECONCILED_RETRY'
            : notInvoked ? 'READ_NOT_INVOKED_RECOVERED' : 'READ_EXECUTION_INTERRUPTED';
        await manager.query(`INSERT INTO agent_tool_results ("attemptId",output,"errorCode","outputBytes") VALUES ($1,NULL,$2,0)`, [attempt.id, errorCode]);
        const budgetStatus = notInvoked ? 'RELEASED' : 'SETTLED';
        const budget = await manager.query(`WITH updated AS (
          UPDATE agent_budget_reservations SET status=$2,"settledAt"=clock_timestamp()
          WHERE "attemptId"=$1 AND status='RESERVED' RETURNING "attemptId"
        ) SELECT "attemptId" FROM updated`, [attempt.id, budgetStatus]);
        if (budget.length !== 1) throw new Error('RECOVERY_BUDGET_CONFLICT');
        await manager.query('UPDATE agent_tool_attempts SET "leaseOwner"=NULL WHERE id=$1 AND "leaseOwner"=$2', [attempt.id, this.workerId]);
        return true;
      });
      if (changed) recovered.push(candidate.id);
    }
    return recovered;
  }

  /** 全局恢复入口：只枚举已有安全恢复标记的用户，再复用逐用户锁定流程。 */
  async recoverExpiredAll(limit = 50): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_RECOVERY_REQUEST');
    const users: { userId: string }[] = await this.manager.query(`SELECT DISTINCT a."userId" FROM agent_tool_attempts a
      JOIN agent_budget_reservations b ON b."attemptId"=a.id
      WHERE a.status='STARTED' AND a."leaseExpiresAt"<=clock_timestamp()
        AND b.status='RESERVED' AND b."executionKind"='builtin_read'
      ORDER BY a."userId" LIMIT $1`, [limit]);
    const recovered: string[] = [];
    for (const row of users) {
      if (recovered.length >= limit) break;
      recovered.push(...await this.recoverExpired(row.userId, limit - recovered.length));
    }
    return recovered;
  }

  /** 将数据库时钟已到期的 RETRY_WAIT 重新放回 READY；真正执行仍必须重新走 Executor 领取。 */
  async advanceDueRetries(limit = 50): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_RETRY_SCAN');
    const candidates: { id: string; runId: string; userId: string }[] = await this.manager.query(`SELECT id,"runId","userId"
      FROM agent_tool_calls WHERE status='RETRY_WAIT' AND "retryNotBefore"<=clock_timestamp()
      ORDER BY "retryNotBefore",id LIMIT $1`, [limit]);
    const advanced: string[] = [];
    for (const candidate of candidates) {
      // 与执行器等待路径共用同一到期复核事务，避免两条路径的到期判定不一致。
      const changed = await advanceDueRetry(this.manager,
        { userId: candidate.userId, runId: candidate.runId, callId: candidate.id });
      if (changed) advanced.push(candidate.id);
    }
    return advanced;
  }

  /** 仅可信 builtin/L0/read 且定义声明 safe 时，才把未知只读结果对账为可重放。 */
  private canSafelyRetry(call: AgentToolCall): boolean {
    if (!this.catalog || call.originKind !== 'builtin') return false;
    try {
      const tool = this.catalog.resolve(call.toolName, call.toolVersion);
      return tool.definition.origin.kind === 'builtin' && tool.definition.riskLevel === 'L0' && tool.definition.retryPolicy === 'safe';
    } catch {
      return false;
    }
  }
}
