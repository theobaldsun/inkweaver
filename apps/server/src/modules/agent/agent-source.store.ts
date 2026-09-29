/** Agent Run 来源快照的内部持久化入口。 */
import { createHash, randomUUID } from 'node:crypto';

import { lockAgentOwner } from './agent-data.cleanup';
import { AgentRunSource } from './entity/agent-run-source.entity';

import type { EntityManager } from 'typeorm';

export interface CaptureAgentSource {
  /** 来源文档 UUID。 */
  docId: string;
  /** 来源类型。 */
  retrievalKind: AgentRunSource['retrievalKind'];
  /** 文档标题快照。 */
  title: string;
  /** 受限来源片段。 */
  excerpt: string;
  /** 文档版本时间。 */
  documentUpdatedAt: Date;
  /** 0~1 相关度；无统一分数时可为空。 */
  score: number | null;
}

/** 来源写入稳定错误，不包含其他用户文档存在性。 */
export class AgentSourceStoreError extends Error {
  readonly code: 'INVALID_AGENT_SOURCE_INPUT' | 'AGENT_RUN_NOT_AVAILABLE';

  constructor(code: AgentSourceStoreError['code']) {
    super(code);
    this.name = 'AgentSourceStoreError';
    this.code = code;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 文档版本参与去重，同一 Run 看到新版本时保留新的快照。 */
function sourceKey(source: CaptureAgentSource): string {
  const digest = createHash('sha256').update(JSON.stringify([source.title, source.excerpt, source.retrievalKind])).digest('hex');
  return `doc:${source.docId}@${source.documentUpdatedAt.toISOString()}:${digest}`;
}

function validateSources(userId: string, runId: string, sources: CaptureAgentSource[]): void {
  if (!uuid.test(userId) || !uuid.test(runId) || !Array.isArray(sources) || sources.length > 20) {
    throw new AgentSourceStoreError('INVALID_AGENT_SOURCE_INPUT');
  }
  for (const source of sources) {
    if (!source || !uuid.test(source.docId) || !['rag', 'search', 'tool'].includes(source.retrievalKind)
      || typeof source.title !== 'string' || !source.title.trim() || [...source.title.trim()].length > 500
      || typeof source.excerpt !== 'string' || !source.excerpt.trim() || [...source.excerpt].length > 20000
      || !(source.documentUpdatedAt instanceof Date) || Number.isNaN(source.documentUpdatedAt.getTime())
      || (source.score !== null && (!Number.isFinite(source.score) || source.score < 0 || source.score > 1))) {
      throw new AgentSourceStoreError('INVALID_AGENT_SOURCE_INPUT');
    }
  }
}

export class AgentSourceStore {
  constructor(private readonly manager: EntityManager) {}

  /**
   * 捕获候选来源，尚未标记进入上下文；同版本不同片段独立保存，避免覆盖历史证据。
   * 仅 RUNNING Run 可新增来源，避免终态后悄悄改变审计事实。
   */
  async capture(userId: string, runId: string, sources: CaptureAgentSource[]): Promise<AgentRunSource[]> {
    validateSources(userId, runId, sources);
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' FOR UPDATE`,
        [runId, userId],
      );
      if (rows.length !== 1) throw new AgentSourceStoreError('AGENT_RUN_NOT_AVAILABLE');

      const repository = manager.getRepository(AgentRunSource);
      const captured: AgentRunSource[] = [];
      for (const source of sources) {
        await repository.createQueryBuilder().insert().into(AgentRunSource).values({
          id: randomUUID(), runId, userId, docId: source.docId, sourceKey: sourceKey(source),
          retrievalKind: source.retrievalKind, title: source.title.trim(), excerpt: source.excerpt,
          documentUpdatedAt: source.documentUpdatedAt, score: source.score, usedInContext: false, cited: false,
        }).orIgnore().execute();
        captured.push(await repository.findOneByOrFail({ runId, userId, sourceKey: sourceKey(source) }));
      }
      return captured;
    });
  }

  /** 裁剪完成后记录实际选中的来源；不等同于模型已成功回答或最终引用。 */
  async markContext(userId: string, runId: string, sourceIds: string[]): Promise<void> {
    validateSources(userId, runId, []);
    if (sourceIds.length > 20 || sourceIds.some((id) => !uuid.test(id)) || new Set(sourceIds).size !== sourceIds.length) {
      throw new AgentSourceStoreError('INVALID_AGENT_SOURCE_INPUT');
    }
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const runs = await manager.query(`SELECT id FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' FOR UPDATE`, [runId, userId]);
      if (runs.length !== 1) throw new AgentSourceStoreError('AGENT_RUN_NOT_AVAILABLE');
      const selected = await manager.query(`SELECT id FROM agent_run_sources WHERE "runId"=$1 AND "userId"=$2 AND id=ANY($3::uuid[])`, [runId, userId, sourceIds]);
      if (selected.length !== sourceIds.length) throw new AgentSourceStoreError('INVALID_AGENT_SOURCE_INPUT');
      // 标签与选择在同一事务发布；先清空避免交换标签时撞唯一约束。
      await manager.query('UPDATE agent_run_sources SET "citationLabel"=NULL WHERE "runId"=$1 AND "userId"=$2', [runId, userId]);
      await manager.query(`UPDATE agent_run_sources SET "usedInContext"=(id=ANY($3::uuid[])),
        "citationLabel"=CASE WHEN id=ANY($3::uuid[]) THEN 'S' || array_position($3::uuid[],id)::text ELSE NULL END,"updatedAt"=clock_timestamp()
        WHERE "runId"=$1 AND "userId"=$2`, [runId, userId, sourceIds]);
    });
  }

  /** 按用户和 Run 读取来源历史，不提供跨用户存在性探测。 */
  async list(userId: string, runId: string): Promise<AgentRunSource[]> {
    if (!uuid.test(userId) || !uuid.test(runId)) throw new AgentSourceStoreError('INVALID_AGENT_SOURCE_INPUT');
    return this.manager.getRepository(AgentRunSource).find({
      where: { userId, runId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }
}
