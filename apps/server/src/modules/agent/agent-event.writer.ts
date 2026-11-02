/**
 * Run 与工具调用共用的事务内事件写入器。
 *
 * 设计边界：
 * - 不独立提交：必须与业务写入（状态更新、工具调用等）在同一个事务中，保证"状态+事件"原子。
 * - 不接受外部事件序号：序列号由数据库原子递增分配，防止并发冲突或调用方误传。
 * - 失败必须回滚整个事务：事件丢失会导致前端 SSE 流不完整，不可接受。
 */
import { randomUUID } from 'node:crypto';

import { parseAgentEventBody } from './agent-event';

import type { EntityManager } from 'typeorm';

/**
 * 向 agent_events 表追加一条事件，并原子分配递增序列号。
 *
 * 流程：
 * 1. 事务活跃性校验（必须在事务中）。
 * 2. parseAgentEventBody：校验事件体结构（schemaVersion、type、payload 合法性）。
 * 3. SQL CTE：原子递增 Run 的 lastEventSequence → 用该序列号插入事件 → 返回 sequence。
 * 4. 序列号溢出保护（< 2147483647）。
 *
 * @param run 必须包含 id 和 userId，用于事件归属和序列号分配。
 * @param value 事件体对象，经 parseAgentEventBody 校验后入库。
 */
export async function appendAgentEvent(manager: EntityManager, run: { id: string; userId: string }, value: unknown): Promise<void> {
  // 必须在事务中执行：事件和业务状态必须原子提交。
  if (!manager.queryRunner?.isTransactionActive) throw new Error('AGENT_TRANSACTION_REQUIRED');

  // 校验事件体结构：确保 schemaVersion、type、payload 符合预定义格式。
  const body = parseAgentEventBody(value);

  /**
   * SQL 拆解（PostgreSQL CTE）：
   *
   * WITH allocated AS (
   *   UPDATE "agent_runs"
   *   SET "lastEventSequence" = "lastEventSequence" + 1
   *   WHERE id = $1 AND "userId" = $2 AND "lastEventSequence" < 2147483647
   *   RETURNING "lastEventSequence"
   * )
   * INSERT INTO "agent_events" (id, "runId", "userId", sequence, type, "schemaVersion", payload)
   * SELECT $3, $1, $2, "lastEventSequence", $4, $5, $6::jsonb
   * FROM allocated
   * RETURNING sequence;
   *
   * 设计要点：
   * - 序列号分配与事件插入在同一查询中原子完成，无并发冲突窗口。
   * - UPDATE 的 WHERE 条件包含 "lastEventSequence" < 2147483647：溢出保护。
   * - 如果 Run 不存在或序列号已溢出 → allocated 为空 → INSERT 影响 0 行 → rows.length=0 → 报错。
   * - sequence 字段供前端 SSE 按序接收和断点续传。
   */
  const rows: { sequence: number }[] = await manager.query(`
    WITH allocated AS (
      UPDATE "agent_runs" SET "lastEventSequence" = "lastEventSequence" + 1
      WHERE id = $1 AND "userId" = $2 AND "lastEventSequence" < 2147483647
      RETURNING "lastEventSequence"
    )
    INSERT INTO "agent_events" (id, "runId", "userId", sequence, type, "schemaVersion", payload)
    SELECT $3, $1, $2, "lastEventSequence", $4, $5, $6::jsonb FROM allocated
    RETURNING sequence`, [run.id, run.userId, randomUUID(), body.type, body.schemaVersion, JSON.stringify(body.payload)]);

  // rows.length !== 1：Run 不存在、序列号溢出、或并发异常导致插入失败。
  if (rows.length !== 1) throw new Error('AGENT_EVENT_SEQUENCE_EXHAUSTED');
}
