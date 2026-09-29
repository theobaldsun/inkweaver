/** 模型请求审计边界：开始记录先提交，外部调用在事务外，结束记录失败不能伪装成模型失败。 */
import { randomUUID } from 'node:crypto';

import { lockAgentOwner } from './agent-data.cleanup';
import { AgentModelError, normalizeAgentTokenCount } from './agent-model.client';

import type { AgentModelClient, AgentModelStepRequest, AgentModelStepResult } from './agent-model.client';
import type { EntityManager } from 'typeorm';

export class AgentModelCallRecorder {
  constructor(private readonly manager: EntityManager, private readonly client: Pick<AgentModelClient, 'step' | 'configuredModel' | 'limits'>) {}

  /** 每次调用独立 ID；重启后再次调用模型是真实新尝试，不覆写旧记录。 */
  async step(userId: string, runId: string, request: AgentModelStepRequest): Promise<AgentModelStepResult> {
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!uuid.test(userId) || !uuid.test(runId) || this.manager.queryRunner?.isTransactionActive) throw new Error('INVALID_MODEL_RECORD_CONTEXT');
    const id = randomUUID();
    const configuredModel = this.client.configuredModel();
    if (!configuredModel) throw new AgentModelError('AGENT_MODEL_NOT_CONFIGURED');
    const limits = this.client.limits();
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const runs = await manager.query(`SELECT id FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' FOR UPDATE`, [runId, userId]);
      if (runs.length !== 1) throw new Error('AGENT_RUN_NOT_AVAILABLE');
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
      if (Number(budget.runCalls) >= limits.callsPerRun || Number(budget.dayCalls) >= limits.callsPerUserDay ||
        Number(budget.runTokens) + limits.contextTokens > limits.reservedTokensPerRun ||
        Number(budget.dayTokens) + limits.contextTokens > limits.reservedTokensPerUserDay) throw new Error('AGENT_MODEL_BUDGET_EXCEEDED');
      await manager.query(`INSERT INTO agent_model_calls (id,"runId","userId",model,"reservedTokens") VALUES ($1,$2,$3,$4,$5)`,
        [id, runId, userId, configuredModel, limits.contextTokens]);
    });
    const startedAt = Date.now();
    let result: AgentModelStepResult;
    try {
      result = await this.client.step(request);
    } catch (error) {
      const code = error instanceof AgentModelError ? error.code : 'AGENT_MODEL_CALL_FAILED';
      const observation = error instanceof AgentModelError ? error.observation : undefined;
      const status = code === 'AGENT_MODEL_CANCELLED' ? 'CANCELLED' : code === 'AGENT_MODEL_TIMED_OUT' ? 'TIMED_OUT' : 'FAILED';
      await this.finish(userId, runId, id, status, code, observation?.model ?? configuredModel,
        observation?.usage, observation?.latencyMs ?? Math.max(0, Date.now() - startedAt));
      throw error;
    }
    // 放在 catch 之外：结束审计写入失败时保留 STARTED，不把成功且可能计费的响应记成失败或零费用。
    await this.finish(userId, runId, id, 'SUCCEEDED', null, result.model, result.usage, result.latencyMs);
    return result;
  }

  /** 即使 Run 已取消也允许完成已开始的审计；用户已清理时不能重新创建记录。 */
  private async finish(userId: string, runId: string, id: string, status: string, code: string | null,
    model: string | null, usage: AgentModelStepResult['usage'] | undefined, latencyMs: number): Promise<void> {
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const rows = await manager.query(`WITH updated AS (UPDATE agent_model_calls SET status=$4,"errorCode"=$5,model=$6,
        "inputTokens"=$7,"outputTokens"=$8,"totalTokens"=$9,"latencyMs"=$10,"endedAt"=clock_timestamp()
        WHERE id=$1 AND "runId"=$2 AND "userId"=$3 AND status='STARTED' RETURNING id) SELECT id FROM updated`,
      [id, runId, userId, status, code, model, normalizeAgentTokenCount(usage?.inputTokens),
        normalizeAgentTokenCount(usage?.outputTokens), normalizeAgentTokenCount(usage?.totalTokens), normalizeAgentTokenCount(latencyMs)]);
      if (rows.length !== 1) throw new Error('AGENT_MODEL_RECORD_NOT_SETTLED');
    });
  }
}
