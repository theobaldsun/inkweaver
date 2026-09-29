/** Agent 清理与写入协调；先锁用户，再操作 Run，统一锁顺序避免竞争。 */
import { ConflictException } from '@nestjs/common';

import type { EntityManager } from 'typeorm';

/** 必须在事务中调用；同一用户的 Agent 写入和清理串行化，不替代身份认证。 */
export async function lockAgentOwner(manager: EntityManager, userId: string): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('AGENT_TRANSACTION_REQUIRED');
  const rows = await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (rows.length !== 1) throw new Error('AGENT_OWNER_UNAVAILABLE');
}

/**
 * 在现有用户清理事务内调用。尚未迁移的环境无需删除 Agent 数据。
 * 未结束 Run 一律阻止清理，不将取消请求伪装为执行已停止；事件通过外键级联删除。
 */
export async function deleteAgentData(manager: EntityManager, userId: string): Promise<void> {
  await lockAgentOwner(manager, userId);
  const [tables] = await manager.query(`SELECT to_regclass('agent_runs') IS NOT NULL AS runs,
    to_regclass('agent_events') IS NOT NULL AS events,
    to_regclass('agent_threads') IS NOT NULL AS threads,
    to_regclass('agent_messages') IS NOT NULL AS messages,
    to_regclass('agent_run_sources') IS NOT NULL AS sources,
    to_regclass('agent_model_calls') IS NOT NULL AS models,
    to_regclass('agent_artifacts') IS NOT NULL AS artifacts,
    to_regclass('agent_artifact_versions') IS NOT NULL AS "artifactVersions",
    to_regclass('agent_artifact_sources') IS NOT NULL AS "artifactSources",
    to_regclass('agent_document_saves') IS NOT NULL AS "documentSaves"`);
  if (!tables.runs) {
    if (tables.events || tables.threads || tables.messages || tables.sources || tables.models || tables.artifacts || tables.artifactVersions || tables.artifactSources || tables.documentSaves) throw new Error('INCOMPLETE_AGENT_SCHEMA');
    return;
  }
  if (Boolean(tables.threads) !== Boolean(tables.messages)) throw new Error('INCOMPLETE_AGENT_SCHEMA');
  if (Boolean(tables.artifacts) !== Boolean(tables.artifactVersions) || Boolean(tables.artifacts) !== Boolean(tables.artifactSources)
    || (tables.artifacts && (!tables.threads || !tables.sources))) throw new Error('INCOMPLETE_AGENT_SCHEMA');
  if (tables.documentSaves && !tables.artifactVersions) throw new Error('INCOMPLETE_AGENT_SCHEMA');
  const active = await manager.query(`SELECT id FROM agent_runs WHERE "userId" = $1
    AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT') LIMIT 1`, [userId]);
  if (active.length) throw new ConflictException('存在未结束的 Agent 任务，请等待任务结束后重试');
  // 来源、模型审计及成果版本随 Run 删除；成果头随下面的 Thread 删除，保持同一事务。
  await manager.query('DELETE FROM agent_runs WHERE "userId" = $1', [userId]);
  if (tables.threads) await manager.query('DELETE FROM agent_threads WHERE "userId" = $1', [userId]);
}
