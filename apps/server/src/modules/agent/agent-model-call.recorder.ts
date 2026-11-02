/** 模型请求审计边界：开始记录先提交，外部调用在事务外，结束记录失败不能伪装成模型失败。 */
import { randomUUID } from 'node:crypto';

import { lockAgentOwner } from './agent-data.cleanup';
import { AgentModelError, normalizeAgentTokenCount } from './agent-model.client';

import type { AgentModelClient, AgentModelStepRequest, AgentModelStepResult } from './agent-model.client';
import type { EntityManager } from 'typeorm';

export class AgentModelCallRecorder {
  constructor(private readonly manager: EntityManager, private readonly client: Pick<AgentModelClient, 'step' | 'configuredModel' | 'limits'>) {}

  /**
   * 模型调用统一入口：先审计预占 → 调用模型 → 审计结算。
   *
   * 设计原则：
   * - 开始记录（INSERT STARTED）必须在模型调用前事务提交，确保"预算已扣"先于"请求发出"。
   * - 模型调用在事务外进行（网络 IO 不能占用连接），所以 step() 要求传入的 manager 不在事务中。
   * - 异常时先 finish 记失败状态再抛出，不能吞掉异常也不能让审计悬空。
   * - 结束审计写入失败时保留 STARTED 状态，不把可能已计费的成功响应伪造成失败或零费用。
   */
  async step(userId: string, runId: string, request: AgentModelStepRequest): Promise<AgentModelStepResult> {
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    // 守卫：manager 不能在事务中，因为模型调用本身在事务外进行，事务会占用连接。
    if (!uuid.test(userId) || !uuid.test(runId) || this.manager.queryRunner?.isTransactionActive) throw new Error('INVALID_MODEL_RECORD_CONTEXT');
    const id = randomUUID();
    const configuredModel = this.client.configuredModel();
    if (!configuredModel) throw new AgentModelError('AGENT_MODEL_NOT_CONFIGURED');
    const limits = this.client.limits();

    // 阶段一：审计预占（事务内）。
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const runs = await manager.query(`SELECT id FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' FOR UPDATE`, [runId, userId]);
      if (runs.length !== 1) throw new Error('AGENT_RUN_NOT_AVAILABLE');

      // 统计当前 Run 和当日的调用次数与预占 token 总额（含本次 contextTokens 做保守估计）。
      // 同一用户的并发 Run 串行预占；额度不因切换模型配置或请求失败而清零。
      const [budget] = await manager.query(`SELECT
        count(*) FILTER (WHERE "runId"=$2)::int AS "runCalls",
        count(*) FILTER (WHERE "createdAt">=date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS "dayCalls",
        COALESCE(sum(COALESCE("reservedTokens",$3)) FILTER (WHERE "runId"=$2),0)::text AS "runTokens",
        COALESCE(sum(COALESCE("reservedTokens",$3)) FILTER (WHERE "createdAt">=date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::text AS "dayTokens"
        FROM agent_model_calls WHERE "userId"=$1 AND ("runId"=$2 OR "createdAt">=date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      [userId, runId, limits.contextTokens]);
      if (!budget || ![budget.runCalls, budget.dayCalls, budget.runTokens, budget.dayTokens].every((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0)) {
        throw new Error('AGENT_MODEL_BUDGET_UNAVAILABLE');
      }
      // 额度超限检查：Run 级调用次数 / 日调用次数 / Run 级预占 token / 日预占 token 任一超限即拒绝。
      if (Number(budget.runCalls) >= limits.callsPerRun || Number(budget.dayCalls) >= limits.callsPerUserDay ||
        Number(budget.runTokens) + limits.contextTokens > limits.reservedTokensPerRun ||
        Number(budget.dayTokens) + limits.contextTokens > limits.reservedTokensPerUserDay) throw new Error('AGENT_MODEL_BUDGET_EXCEEDED');

      // 预占额度：以 STARTED 状态插入记录，id 为本次调用唯一标识。
      await manager.query(`INSERT INTO agent_model_calls (id,"runId","userId",model,"reservedTokens") VALUES ($1,$2,$3,$4,$5)`,
        [id, runId, userId, configuredModel, limits.contextTokens]);
    });

    // 阶段二：事务外调用模型（网络 IO 不阻塞连接池）。
    const startedAt = Date.now();
    let result: AgentModelStepResult;
    try {
      result = await this.client.step(request);
    } catch (error) {
      // 异常分类：AgentModelError 携带业务级 code 和 observation；其他异常统一记为 CALL_FAILED。
      const code = error instanceof AgentModelError ? error.code : 'AGENT_MODEL_CALL_FAILED';
      const observation = error instanceof AgentModelError ? error.observation : undefined;
      const status = code === 'AGENT_MODEL_CANCELLED' ? 'CANCELLED' : code === 'AGENT_MODEL_TIMED_OUT' ? 'TIMED_OUT' : 'FAILED';
      await this.finish(userId, runId, id, status, code, observation?.model ?? configuredModel,
        observation?.usage, observation?.latencyMs ?? Math.max(0, Date.now() - startedAt));
      throw error;
    }

    // 阶段三：审计结算（catch 之外）。
    // 放在 catch 之外：结束审计写入失败时保留 STARTED，不把成功且可能计费的响应记成失败或零费用。
    await this.finish(userId, runId, id, 'SUCCEEDED', null, result.model, result.usage, result.latencyMs);
    return result;
  }

  /**
   * 审计结算：把阶段一插入的 STARTED 记录更新为终态（SUCCEEDED / FAILED / CANCELLED / TIMED_OUT）。
   *
   * 设计要点：
   * - 用 CTE + RETURNING 做行级 CAS：只有 status='STARTED' 的记录能被更新，防重复结算/并发竞态。
   * - 即使 Run 已取消也允许完成已开始的审计（费用已发生），但用户已清理时不能重新创建记录。
   * - 所有 token/latency 字段走 normalizeAgentTokenCount：非法值保留 null，不伪造成零。
   */
  private async finish(userId: string, runId: string, id: string, status: string, code: string | null,
    model: string | null, usage: AgentModelStepResult['usage'] | undefined, latencyMs: number): Promise<void> {
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      /**
       * SQL 拆解（PostgreSQL CTE + UPDATE + RETURNING）：
       *
       * WITH updated AS (
       *   UPDATE agent_model_calls
       *   SET status=$4,          -- 终态：SUCCEEDED / FAILED / CANCELLED / TIMED_OUT
       *       "errorCode"=$5,     -- 失败原因代码；成功时为 null
       *       model=$6,           -- 实际使用的模型标识（可能与配置不同，如供应商 fallback）
       *       "inputTokens"=$7,   -- 输入 token 数（normalize 后）
       *       "outputTokens"=$8,  -- 输出 token 数
       *       "totalTokens"=$9,   -- 总 token 数
       *       "latencyMs"=$10,    -- 调用耗时毫秒
       *       "endedAt"=clock_timestamp()  -- PostgreSQL 服务器当前时间戳
       *   WHERE id=$1 AND "runId"=$2 AND "userId"=$3 AND status='STARTED'
       *   RETURNING id
       * )
       * SELECT id FROM updated;
       *
       * CAS（Compare-And-Swap）语义：
       * - WHERE status='STARTED'：只有未结算记录能被更新。
       * - 如果记录已被其他进程结算（status 已变）→ UPDATE 影响 0 行 → RETURNING 空 → rows.length=0 → 报错。
       * - 如果记录不存在 → 同样 rows.length=0 → 报错。
       * - 正常情况 → 更新 1 行 → RETURNING 1 个 id → rows.length=1 → 通过。
       */
      const rows = await manager.query(`WITH updated AS (UPDATE agent_model_calls SET status=$4,"errorCode"=$5,model=$6,
        "inputTokens"=$7,"outputTokens"=$8,"totalTokens"=$9,"latencyMs"=$10,"endedAt"=clock_timestamp()
        WHERE id=$1 AND "runId"=$2 AND "userId"=$3 AND status='STARTED' RETURNING id) SELECT id FROM updated`,
      [id, runId, userId, status, code, model, normalizeAgentTokenCount(usage?.inputTokens),
        normalizeAgentTokenCount(usage?.outputTokens), normalizeAgentTokenCount(usage?.totalTokens), normalizeAgentTokenCount(latencyMs)]);
      // rows.length !== 1：记录不存在、或已被其他进程结算、或并发竞态导致重复更新。
      if (rows.length !== 1) throw new Error('AGENT_MODEL_RECORD_NOT_SETTLED');
    });
  }
}
