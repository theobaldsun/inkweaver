/**
 * 工具调用执行代次写入器。
 * 仅由 ToolCallStore.transition 在用户锁及 CAS 条件更新之后调用；失败必须回滚整个事务。
 */
import { randomUUID } from 'node:crypto';

import { AgentToolAttempt } from '../entity/agent-tool-attempt.entity';

import type { ToolCallEvent } from './tool-call-lifecycle';
import type { AgentToolCall } from '../entity/agent-tool-call.entity';
import type { EntityManager } from 'typeorm';

/**
 * 写入工具调用的执行代次记录（AgentToolAttempt）。
 *
 * 设计边界：
 * - 不接受旧尝试回写新代次；UUID 匹配是事实绑定，不是执行授权。
 * - 必须在事务中执行（事务活跃性校验）。
 * - START 事件：创建新代次；其他终态事件：更新已有代次状态。
 *
 * @param expectedAttemptId 非 START 事件时必须提供，确保更新的是正确的执行代次。
 */
export async function writeToolAttempt(manager: EntityManager, call: AgentToolCall, event: ToolCallEvent, expectedAttemptId?: string): Promise<void> {
  // 必须在事务中执行：ToolAttempt 和 ToolCall 的状态必须原子一致。
  if (!manager.queryRunner?.isTransactionActive) throw new Error('AGENT_TRANSACTION_REQUIRED');
  const repository = manager.getRepository(AgentToolAttempt);

  // ── 分支一：START 事件 → 创建新的执行代次 ──
  if (event.type === 'START') {
    // 历史完整性校验：attemptCount > 1 时，前一 attempt 必须存在且已结束（不能是 STARTED）。
    // 旧调用如缺少历史，不猜测或伪造；必须先由后续迁移/恢复策略核对。
    if (call.attemptCount > 1) {
      const previous = await repository.findOneBy({ callId: call.id, runId: call.runId, userId: call.userId, attemptNumber: call.attemptCount - 1 });
      if (!previous || previous.status === 'STARTED') throw new Error('TOOL_ATTEMPT_HISTORY_CONFLICT');
    }
    // 插入新代次：状态 STARTED，endedAt 为 null（尚未结束）。
    await repository.insert({ id: randomUUID(), callId: call.id, runId: call.runId, userId: call.userId,
      attemptNumber: call.attemptCount, startRevision: call.revision, status: 'STARTED', endedAt: null });
    return;
  }

  // ── 分支二：非终态事件 → 忽略不写 ──
  // 取消意图（CANCEL_REQUESTED）、确认（CONFIRMED）、退避到期（EXPIRED）不表示一次执行已经结束，不写 Attempt。
  if ((event.type !== 'SUCCEEDED' && event.type !== 'FAILED' && event.type !== 'OUTCOME_UNKNOWN'
    && event.type !== 'RETRY_SCHEDULED' && event.type !== 'STOPPED_WITHOUT_EFFECT') || call.attemptCount === 0) return;

  // ── 分支三：终态事件 → 更新已有执行代次 ──
  if (!expectedAttemptId) throw new Error('TOOL_ATTEMPT_ID_REQUIRED');

  // 加载目标代次：必须匹配 callId + attemptNumber，确保更新的是当前轮次。
  const current = await repository.findOneBy({ id: expectedAttemptId, callId: call.id, runId: call.runId,
    userId: call.userId, attemptNumber: call.attemptCount });
  if (!current) throw new Error('TOOL_ATTEMPT_UPDATE_CONFLICT');

  // 状态守卫：只有 STARTED 或 OUTCOME_UNKNOWN 的代次能被更新。
  // 重试已排队后执行前失败，不能把前轮结果覆盖成此次调度失败。
  if (current.status !== 'STARTED' && current.status !== 'OUTCOME_UNKNOWN') {
    if (event.type === 'FAILED') return;  // 已终态的代次再收到 FAILED → 静默忽略（不覆盖）
    throw new Error('TOOL_ATTEMPT_UPDATE_CONFLICT');
  }

  // 事件类型 → Attempt 状态映射
  const status = event.type === 'STOPPED_WITHOUT_EFFECT' ? 'CANCELLED'
    : event.type === 'RETRY_SCHEDULED' ? (event.sideEffect === 'unknown' ? 'OUTCOME_UNKNOWN' : 'FAILED') : event.type;

  // CAS 更新：只有 status 匹配时才更新；endedAt 用 COALESCE 保留最初结束时间（对账补全时不改历史时点）。
  const result = await repository.createQueryBuilder().update().set({ status,
    endedAt: () => 'COALESCE("endedAt", clock_timestamp())',
  }).where('id = :id AND status = :status', { id: current.id, status: current.status }).execute();
  if (result.affected !== 1) throw new Error('TOOL_ATTEMPT_UPDATE_CONFLICT');
}
