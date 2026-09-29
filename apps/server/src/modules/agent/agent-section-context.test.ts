/** 离线验证来源继承与标签分配；事务及外键的实际语义留待 PostgreSQL 验收。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareSectionContext } from './agent-section-context';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';

import type { AgentRunSource } from './entity/agent-run-source.entity';
import type { AgentRun } from './entity/agent-run.entity';
import type { EntityManager } from 'typeorm';

const id = (digit: number) => `${digit}1111111-1111-4111-8111-111111111111`;

test('旧引用稀疏标签保持不变，新来源从最大编号之后追加，重放不复制新记录', async () => {
  const run = { id: id(1), userId: id(2), threadId: id(3), revisionArtifactId: id(4), revisionBaseVersion: 2,
    revisionRange: { start: 0, end: 2 }, goal: '修改开头' } as AgentRun;
  const base = { id: id(5), version: 2, title: '标题', content: '开头 保留 [S3]' };
  const old = { id: id(6), docId: id(7), label: 'S3', title: '旧证据', excerpt: '历史资料', documentUpdatedAt: null };
  const candidate = { id: id(8), runId: run.id, userId: run.userId, docId: id(7), retrievalKind: 'rag', title: '新证据', excerpt: '新资料' } as AgentRunSource;
  let captured: Record<string, unknown> | undefined;
  const labels = new Map<string, string>();
  const sourceRepo = {
    createQueryBuilder: () => {
      let value: Record<string, unknown>;
      const chain = { insert: () => chain, into: () => chain, values: (input: Record<string, unknown>) => { value = input; return chain; },
        orIgnore: () => chain, execute: async () => { captured ??= value; } };
      return chain;
    },
    findOneByOrFail: async () => captured,
    update: async (where: { id: string }, value: { citationLabel: string }) => { labels.set(where.id, value.citationLabel); },
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    transaction: async (_isolation: string, fn: (value: unknown) => Promise<unknown>) => fn(manager),
    getRepository: (entity: unknown) => entity === AgentArtifactVersion ? { findOneBy: async () => base, findOne: async () => base } : sourceRepo,
    query: async (sql: string) => {
      if (sql.includes('FROM users') || sql.includes('FROM agent_runs')) return [{ id: run.id }];
      if (sql.startsWith('UPDATE')) return [];
      if (sql.includes('SELECT s.*')) return [old];
      if (sql.includes('FROM agent_artifact_sources')) return [{ docId: old.docId }];
      if (sql.includes('FROM documents')) return [{ title: '当前文档', content: '当前内容' }];
      assert.fail(sql);
    },
  } as unknown as EntityManager;
  const scope = { allowOwnedLibrary: true, documentIds: [], folderIds: [] };
  const first = await prepareSectionContext(manager, run, scope, [candidate]);
  const again = await prepareSectionContext(manager, run, scope, [candidate]);
  assert.deepEqual(first.citations, again.citations);
  assert.deepEqual([...labels.values()], ['S3', 'S4']);
  assert.equal(captured?.inheritedFromSourceId, old.id);
  assert.equal(captured?.retrievalKind, 'revision');
  assert.equal(captured?.documentVersion, null);
  assert.match(first.messages[1]!.text, /历史资料/);
  assert.match(first.messages[0]!.text, /历史快照/);
});
