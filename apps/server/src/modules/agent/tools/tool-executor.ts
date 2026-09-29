/** 首版受控只读执行：领取/预算/租约同事务，适配器在事务外，结果和结算同事务。 */
import { randomUUID } from 'node:crypto';

import { ToolAuthorization } from './tool-authorization';
import { ToolCallStore } from './tool-call.store';
import { defaultToolExecutionRegistry } from './tool-execution-registry';
import { advanceDueRetry, ToolRetryPolicy } from './tool-retry';
import { lockAgentOwner } from '../agent-data.cleanup';

import type { ToolAuthorizationContext } from './tool-authorization';
import type { ToolCatalog } from './tool-catalog';
import type { ToolJsonValue } from './tool-definition';
import type { ToolExecutionRegistry } from './tool-execution-registry';
import type { AgentToolCall } from '../entity/agent-tool-call.entity';
import type { EntityManager } from 'typeorm';

export interface ToolExecutionResult {
  /** 最新调用状态，取消/失败不会伪装成成功。 */
  call: AgentToolCall;
  /** 本轮结果的关联 ID。 */
  attemptId: string;
  /** 校验通过的 JSON 结果；失败时为 null。 */
  output: ToolJsonValue;
  /** 稳定错误码，不保存供应商异常正文；成功时为 null。 */
  errorCode: string | null;
}

export interface ToolExecutorOptions {
  /** 当前 Worker UUID；同一进程实例应稳定复用，不从用户输入读取。 */
  workerId?: string;
  /** 单次租约长度；执行中由心跳续租，进程失联后自然到期。 */
  leaseDurationMs?: number;
  /** 续租和跨进程取消检查频率。 */
  heartbeatIntervalMs?: number;
  /** 进程内主动取消桥接；默认使用模块级共享实例。 */
  registry?: ToolExecutionRegistry;
  /** 单个逻辑调用允许的最大执行尝试数；使用持久化 attemptCount 跨重启计数。 */
  maxAttempts?: number;
  /** 首次安全重试的退避毫秒数。 */
  retryBaseDelayMs?: number;
  /** 指数退避上限毫秒数。 */
  retryMaxDelayMs?: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ToolExecutor {
  private readonly workerId: string;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly registry: ToolExecutionRegistry;
  /** 与恢复控制共用同一退避语义；重试次数上限与退避时长只在此处裁决。 */
  private readonly retry: ToolRetryPolicy;

  /** 注入非事务 manager，防止外部调用期间持有上层事务。 */
  constructor(private readonly manager: EntityManager, private readonly catalog: ToolCatalog, options: ToolExecutorOptions = {}) {
    this.workerId = options.workerId ?? randomUUID();
    this.leaseDurationMs = options.leaseDurationMs ?? 5000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1000;
    this.registry = options.registry ?? defaultToolExecutionRegistry;
    // 重试边界由共享策略校验，避免与恢复控制的退避语义漂移。
    this.retry = new ToolRetryPolicy(options);
    if (!uuid.test(this.workerId) || !Number.isInteger(this.leaseDurationMs) || this.leaseDurationMs < 100 || this.leaseDurationMs > 60000
      || !Number.isInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 25 || this.heartbeatIntervalMs >= this.leaseDurationMs) {
      throw new Error('INVALID_EXECUTOR_OPTIONS');
    }
  }

  /**
   * 执行一个逻辑只读调用，并在当前进程仍存活时完成有限安全重试。
   * 每轮重试都会回到 READY 后重新执行授权、确认、预算和租约领取，不能直接重放适配器。
   */
  async execute(userId: string, runId: string, callId: string, context: ToolAuthorizationContext): Promise<ToolExecutionResult> {
    let result = await this.executeAttempt(userId, runId, callId, context);
    while (result.call.status === 'RETRY_WAIT') {
      const ready = await this.waitUntilRetryDue(userId, runId, callId);
      if (!ready) {
        const call = await new ToolCallStore(this.manager).get(userId, runId, callId);
        if (!call) throw new Error('CALL_NOT_FOUND');
        return { ...result, call, errorCode: call.status === 'CANCELLED' ? 'TOOL_CANCELLED' : result.errorCode };
      }
      result = await this.executeAttempt(userId, runId, callId, context);
    }
    return result;
  }

  /**
   * 单轮领取与执行：仅接受可信注册的 builtin/L0/read 适配器；不开放 MCP 或写工具。
   * START、Attempt、预算和 Worker 租约在同一领取事务提交；过期 Worker永远不能提交结果。
   */
  private async executeAttempt(userId: string, runId: string, callId: string, context: ToolAuthorizationContext): Promise<ToolExecutionResult> {
    if (this.manager.queryRunner?.isTransactionActive) throw new Error('EXECUTION_REQUIRES_ROOT_MANAGER');
    const snapshot = structuredClone(context);
    const claim = await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const checked = await new ToolAuthorization(manager, this.catalog).recheck(userId, runId, callId, snapshot);
      const tool = this.catalog.resolve(checked.call.toolName, checked.call.toolVersion);
      if (tool.definition.origin.kind !== 'builtin' || tool.definition.riskLevel !== 'L0'
        || checked.resources.some((resource) => resource.action !== 'read') || tool.definition.timeoutMs > 60000) throw new Error('EXECUTION_NOT_SUPPORTED');
      const [budget] = await manager.query(`SELECT r."toolCallLimit" AS limit,
        (SELECT count(*)::integer FROM agent_budget_reservations b JOIN agent_tool_attempts a ON a.id=b."attemptId"
         WHERE a."runId"=r.id AND b.status <> 'RELEASED') AS used FROM agent_runs r WHERE r.id=$1 AND r."userId"=$2`, [runId, userId]);
      if (!budget || budget.used >= budget.limit) throw new Error('TOOL_BUDGET_EXHAUSTED');
      const store = new ToolCallStore(manager);
      const call = await store.transition(userId, runId, callId, checked.call.revision, { type: 'START' });
      const attempt = (await store.getAttempt(userId, runId, callId, call.attemptCount))!;
      // attempt 是本事务刚创建的当前代次；调用状态的条件 START 已经保证只有一个领取者。
      const leased = await manager.query(`WITH updated AS (
        UPDATE agent_tool_attempts SET "leaseOwner"=$2,
          "leaseExpiresAt"=clock_timestamp() + $3 * interval '1 millisecond'
        WHERE id=$1 RETURNING id
      ) SELECT id FROM updated`, [attempt.id, this.workerId, this.leaseDurationMs]);
      if (leased.length !== 1) throw new Error('EXECUTION_CLAIM_CONFLICT');
      await manager.query(`INSERT INTO agent_budget_reservations ("attemptId",status,"executionKind")
        VALUES ($1,'RESERVED','builtin_read')`, [attempt.id]);
      return { call, attempt, resources: checked.resources, tool };
    });

    const controller = new AbortController();
    const unregister = this.registry.register(userId, runId, callId, claim.attempt.id, this.workerId, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatStopped = false;
    let timedOut = false;
    let claimLost = false;
    let output: ToolJsonValue = null;
    let errorCode: string | null = null;

    const stopHeartbeat = () => {
      heartbeatStopped = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
    };
    const heartbeat = async (): Promise<void> => {
      if (heartbeatStopped) return;
      try {
        const rows = await this.manager.query(`WITH renewed AS (
          UPDATE agent_tool_attempts SET "leaseExpiresAt"=clock_timestamp() + $4 * interval '1 millisecond'
          WHERE id=$1 AND "userId"=$2 AND "leaseOwner"=$3 AND status='STARTED'
            AND "leaseExpiresAt">clock_timestamp()
          RETURNING "callId","runId","userId")
          SELECT c."cancelRequested" FROM renewed r JOIN agent_tool_calls c
            ON c.id=r."callId" AND c."runId"=r."runId" AND c."userId"=r."userId"`,
        [claim.attempt.id, userId, this.workerId, this.leaseDurationMs]);
        if (rows.length !== 1) {
          claimLost = true;
          controller.abort();
          stopHeartbeat();
          return;
        }
        if (rows[0].cancelRequested) controller.abort();
      } catch {
        // 续租状态未知时 fail closed：旧 Worker 不再提交，交给过期恢复流程处理。
        claimLost = true;
        controller.abort();
        stopHeartbeat();
        return;
      }
      heartbeatTimer = setTimeout(() => { void heartbeat(); }, this.heartbeatIntervalMs);
    };

    try {
      // 领取后撤销目录不能继续使用旧句柄；目标归属和版本由实际文档读取再次检查。
      const current = this.catalog.resolve(claim.call.toolName, claim.call.toolVersion);
      if (current.execute !== claim.tool.execute) throw new Error('TOOL_REPLACED');
      // 调用边界必须先落库；若取消已在领取后提交，则不越过该边界并释放预算。
      const started = await this.manager.query(`WITH updated AS (
        UPDATE agent_tool_attempts a SET "invocationStartedAt"=clock_timestamp()
        WHERE a.id=$1 AND a."userId"=$2 AND a."leaseOwner"=$3 AND a.status='STARTED'
          AND a."leaseExpiresAt">clock_timestamp() AND a."invocationStartedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM agent_tool_calls c WHERE c.id=a."callId" AND c."runId"=a."runId"
            AND c."userId"=a."userId" AND c."cancelRequested"=true)
        RETURNING a.id
      ) SELECT id FROM updated`, [claim.attempt.id, userId, this.workerId]);
      if (started.length !== 1) {
        const [state] = await this.manager.query(`SELECT a.status,a."leaseOwner",a."leaseExpiresAt"<=clock_timestamp() AS expired,
          c."cancelRequested" FROM agent_tool_attempts a JOIN agent_tool_calls c
            ON c.id=a."callId" AND c."runId"=a."runId" AND c."userId"=a."userId"
          WHERE a.id=$1 AND a."userId"=$2`, [claim.attempt.id, userId]);
        if (state?.status === 'STARTED' && state.leaseOwner === this.workerId && !state.expired && state.cancelRequested) {
          errorCode = 'TOOL_CANCELLED';
        } else {
          claimLost = true;
          throw new Error('EXECUTION_CLAIM_LOST');
        }
      } else {
        void heartbeat();
        const expired = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('TOOL_TIMEOUT'));
          }, claim.tool.definition.timeoutMs);
        });
        const raw = await Promise.race([current.execute(claim.call.input as ToolJsonValue,
          { userId, runId, signal: controller.signal, execution: { callId, attemptId: claim.attempt.id,
            attemptNumber: claim.attempt.attemptNumber, idempotencyKey: callId, resources: claim.resources } }), expired]);
        if (controller.signal.aborted) errorCode = timedOut ? 'TOOL_TIMEOUT' : 'TOOL_CANCELLED';
        if (!errorCode) {
          const serialized = JSON.stringify(raw);
          if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > current.definition.maxOutputBytes) errorCode = 'TOOL_OUTPUT_LIMIT';
          else {
            const decoded: ToolJsonValue = JSON.parse(serialized);
            if (!current.validateOutput(decoded).ok) errorCode = 'INVALID_TOOL_OUTPUT';
            else output = decoded;
          }
        }
      }
    } catch {
      if (claimLost) throw new Error('EXECUTION_CLAIM_LOST');
      errorCode = timedOut ? 'TOOL_TIMEOUT' : controller.signal.aborted ? 'TOOL_CANCELLED' : 'TOOL_EXECUTION_FAILED';
    } finally {
      if (timer) clearTimeout(timer);
      stopHeartbeat();
      unregister();
    }
    if (claimLost) throw new Error('EXECUTION_CLAIM_LOST');

    // 迟到 Promise 不会进入提交路径；只有仍持有有效租约的当前 Worker 才能结算。
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const store = new ToolCallStore(manager);
      const call = await store.get(userId, runId, callId);
      const [attempt] = await manager.query(`SELECT id,status,"leaseOwner","leaseExpiresAt"<=clock_timestamp() AS expired,
        "invocationStartedAt" FROM agent_tool_attempts WHERE id=$1 AND "callId"=$2 AND "userId"=$3 AND "attemptNumber"=$4`,
      [claim.attempt.id, callId, userId, call?.attemptCount]);
      if (!call || call.status !== 'EXECUTING' || !attempt || attempt.status !== 'STARTED'
        || attempt.leaseOwner !== this.workerId || attempt.expired) throw new Error('EXECUTION_CLAIM_LOST');
      const actuallyInvoked = attempt.invocationStartedAt !== null;
      if (call.cancelRequested && !timedOut) errorCode = 'TOOL_CANCELLED';
      if (timedOut) errorCode = 'TOOL_TIMEOUT';
      if (errorCode) output = null;
      // 只有适配器已返回/拒绝且非超时，才可确认取消已经结束；超时不声称底层请求已停止。
      const retryable = !call.cancelRequested && errorCode !== null
        && ['TOOL_TIMEOUT', 'TOOL_EXECUTION_FAILED'].includes(errorCode)
        && claim.tool.definition.retryPolicy === 'safe' && this.retry.canRetry(call.attemptCount);
      const event = call.cancelRequested && !timedOut
        ? { type: 'STOPPED_WITHOUT_EFFECT' as const }
        : retryable ? { type: 'RETRY_SCHEDULED' as const, sideEffect: 'none' as const, guarantee: 'safe' as const }
          : errorCode ? { type: 'FAILED' as const, sideEffect: 'none' as const } : { type: 'SUCCEEDED' as const, sideEffect: 'none' as const };
      const updated = await store.transition(userId, runId, callId, call.revision, event, claim.attempt.id);
      if (retryable) {
        // 截止时间与本轮结算同一事务提交；失败会连同状态迁移一起回滚。
        await this.retry.schedule(manager, { userId, runId, callId }, call.attemptCount);
      }
      const serialized = errorCode ? null : JSON.stringify(output);
      await manager.query(`INSERT INTO agent_tool_results ("attemptId",output,"errorCode","outputBytes") VALUES ($1,$2::jsonb,$3,$4)`,
        [claim.attempt.id, serialized, errorCode, serialized === null ? 0 : Buffer.byteLength(serialized, 'utf8')]);
      const budgetStatus = actuallyInvoked ? 'SETTLED' : 'RELEASED';
      const budget = await manager.query(`WITH updated AS (
        UPDATE agent_budget_reservations SET status=$2,"settledAt"=clock_timestamp()
        WHERE "attemptId"=$1 AND status='RESERVED' RETURNING "attemptId"
      ) SELECT "attemptId" FROM updated`, [claim.attempt.id, budgetStatus]);
      if (budget.length !== 1) throw new Error('BUDGET_SETTLEMENT_CONFLICT');
      await manager.query('UPDATE agent_tool_attempts SET "leaseOwner"=NULL WHERE id=$1 AND "leaseOwner"=$2', [claim.attempt.id, this.workerId]);
      return { call: updated, attemptId: claim.attempt.id, output, errorCode };
    });
  }

  /** 使用数据库截止时间等待退避，并以状态机事件重新进入 READY。 */
  private async waitUntilRetryDue(userId: string, runId: string, callId: string): Promise<boolean> {
    for (;;) {
      const rows = await this.manager.query(`SELECT status,"retryNotBefore",
        GREATEST(0, EXTRACT(EPOCH FROM ("retryNotBefore"-clock_timestamp())) * 1000)::integer AS "waitMs"
        FROM agent_tool_calls WHERE id=$1 AND "runId"=$2 AND "userId"=$3`, [callId, runId, userId]);
      const row = rows[0];
      // 维护扫描可能已先把同一调用推进 READY；这表示退避已经合法结束，不应把它误当作取消。
      if (row?.status === 'READY') return true;
      if (!row || row.status !== 'RETRY_WAIT' || !row.retryNotBefore) return false;
      if (row.waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(row.waitMs, 250)));
        continue;
      }
      // 到点后的状态迁移与恢复扫描共用同一复核事务，避免两条路径的到期判定不一致。
      return advanceDueRetry(this.manager, { userId, runId, callId });
    }
  }
}
