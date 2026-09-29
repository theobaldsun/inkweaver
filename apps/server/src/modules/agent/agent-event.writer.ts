/** Run 与工具调用共用的事务内事件写入，不独立提交，也不接受外部事件序号。 */
import { randomUUID } from 'node:crypto';

import { parseAgentEventBody } from './agent-event';

import type { EntityManager } from 'typeorm';

/** 调用方须先取得用户锁并完成本事务业务写入；失败必须向外传播以回滚整个事务。 */
export async function appendAgentEvent(manager: EntityManager, run: { id: string; userId: string }, value: unknown): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('AGENT_TRANSACTION_REQUIRED');
  const body = parseAgentEventBody(value);
  const rows: { sequence: number }[] = await manager.query(`
    WITH allocated AS (
      UPDATE "agent_runs" SET "lastEventSequence" = "lastEventSequence" + 1
      WHERE id = $1 AND "userId" = $2 AND "lastEventSequence" < 2147483647
      RETURNING "lastEventSequence"
    )
    INSERT INTO "agent_events" (id, "runId", "userId", sequence, type, "schemaVersion", payload)
    SELECT $3, $1, $2, "lastEventSequence", $4, $5, $6::jsonb FROM allocated
    RETURNING sequence`, [run.id, run.userId, randomUUID(), body.type, body.schemaVersion, JSON.stringify(body.payload)]);
  if (rows.length !== 1) throw new Error('AGENT_EVENT_SEQUENCE_EXHAUSTED');
}
