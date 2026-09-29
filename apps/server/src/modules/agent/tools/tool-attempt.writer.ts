/** 仅由 ToolCallStore 在用户锁及调用条件更新之后调用；失败必须回滚整个事务。 */
import { randomUUID } from 'node:crypto';

import { AgentToolAttempt } from '../entity/agent-tool-attempt.entity';

import type { ToolCallEvent } from './tool-call-lifecycle';
import type { AgentToolCall } from '../entity/agent-tool-call.entity';
import type { EntityManager } from 'typeorm';

/** 不接受旧尝试回写新代次；UUID 匹配是事实绑定，不是执行授权。 */
export async function writeToolAttempt(manager: EntityManager, call: AgentToolCall, event: ToolCallEvent, expectedAttemptId?: string): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('AGENT_TRANSACTION_REQUIRED');
  const repository = manager.getRepository(AgentToolAttempt);
  if (event.type === 'START') {
    // 旧调用如缺少历史，不猜测或伪造；必须先由后续迁移/恢复策略核对。
    if (call.attemptCount > 1) {
      const previous = await repository.findOneBy({ callId: call.id, runId: call.runId, userId: call.userId, attemptNumber: call.attemptCount - 1 });
      if (!previous || previous.status === 'STARTED') throw new Error('TOOL_ATTEMPT_HISTORY_CONFLICT');
    }
    await repository.insert({ id: randomUUID(), callId: call.id, runId: call.runId, userId: call.userId,
      attemptNumber: call.attemptCount, startRevision: call.revision, status: 'STARTED', endedAt: null });
    return;
  }
  // 取消意图、确认和退避到期不表示一次执行已经结束。
  if ((event.type !== 'SUCCEEDED' && event.type !== 'FAILED' && event.type !== 'OUTCOME_UNKNOWN'
    && event.type !== 'RETRY_SCHEDULED' && event.type !== 'STOPPED_WITHOUT_EFFECT') || call.attemptCount === 0) return;
  if (!expectedAttemptId) throw new Error('TOOL_ATTEMPT_ID_REQUIRED');
  const current = await repository.findOneBy({ id: expectedAttemptId, callId: call.id, runId: call.runId,
    userId: call.userId, attemptNumber: call.attemptCount });
  if (!current) throw new Error('TOOL_ATTEMPT_UPDATE_CONFLICT');
  // 重试已排队后执行前失败，不能把前轮结果覆盖成此次调度失败。
  if (current.status !== 'STARTED' && current.status !== 'OUTCOME_UNKNOWN') {
    if (event.type === 'FAILED') return;
    throw new Error('TOOL_ATTEMPT_UPDATE_CONFLICT');
  }
  const status = event.type === 'STOPPED_WITHOUT_EFFECT' ? 'CANCELLED'
    : event.type === 'RETRY_SCHEDULED' ? (event.sideEffect === 'unknown' ? 'OUTCOME_UNKNOWN' : 'FAILED') : event.type;
  const result = await repository.createQueryBuilder().update().set({ status,
    // 对账补全结果时保留最初结束/失联时间，不改写历史时点。
    endedAt: () => 'COALESCE("endedAt", clock_timestamp())',
  }).where('id = :id AND status = :status', { id: current.id, status: current.status }).execute();
  if (result.affected !== 1) throw new Error('TOOL_ATTEMPT_UPDATE_CONFLICT');
}
