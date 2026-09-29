/** 保存准备的离线分支验证；不创建真实文档，不替代数据库并发与约束验收。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentDocumentSaveStore } from './agent-document-save.store';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';

import type { AgentDocumentSave } from './entity/agent-document-save.entity';
import type { EntityManager } from 'typeorm';

const id = (digit: number) => `${digit}1111111-1111-4111-8111-111111111111`;
const userId = id(1), runId = id(2), threadId = id(3), versionId = id(4), folderId = id(5);
const input = { requestKey: 'save-1', artifactVersionId: versionId, folderId };
const scope = { allowOwnedLibrary: true, folderIds: [], documentIds: [] };

function fixture() {
  const records: AgentDocumentSave[] = [];
  const state = { active: true, draft: true, owned: true, folder: true, source: true };
  const version = { id: versionId, kind: 'draft', digest: 'a'.repeat(64) };
  const match = (row: object, where: object) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  const manager = {
    queryRunner: { isTransactionActive: true },
    transaction: async (_isolation: string, action: (value: unknown) => Promise<unknown>) => action(manager),
    getRepository: (entity: unknown) => entity === AgentArtifactVersion ? {
      findOneBy: async (where: object) => { assert.deepEqual(where, { id: versionId, userId, threadId }); return state.owned ? { ...version, kind: state.draft ? 'draft' : 'outline' } : null; },
    } : {
      findOneBy: async (where: object) => records.find((row) => match(row, where)) ?? null,
      findOneByOrFail: async (where: object) => { const found = records.find((row) => match(row, where)); assert.ok(found); return found; },
      insert: async (value: AgentDocumentSave) => { records.push(value); },
    },
    query: async (sql: string) => {
      if (sql.includes('FROM users')) return [{ id: userId }];
      if (sql.includes('FROM agent_runs')) return state.active ? [{ threadId }] : [];
      if (sql.includes('FROM agent_artifact_sources')) return [{ docId: id(6) }];
      if (sql.includes('FROM folders')) return state.folder ? [{ name: '目标', parentId: null }] : [];
      if (sql.includes('FROM documents')) return state.source ? [{ title: '来源', content: '正文' }] : [];
      assert.fail(sql);
    },
  } as unknown as EntityManager;
  return { store: new AgentDocumentSaveStore(manager), records, state };
}

test('同键重放固定操作和文档 ID；未创建文档，不伪装已保存', async () => {
  const f = fixture();
  const first = await f.store.prepare(userId, runId, input, scope);
  const again = await f.store.prepare(userId, runId, input, scope);
  assert.equal(first.id, again.id);
  assert.equal(first.documentId, again.documentId);
  assert.equal(first.status, 'PREPARED');
  assert.equal(first.savedAt, null);
  assert.equal(f.records.length, 1);
  assert.equal(await f.store.get(id(9), first.id), null);
});

test('同键改变目的地冲突，换键或换 Run 也不能重复绑定同版本', async () => {
  const f = fixture();
  await f.store.prepare(userId, runId, input, scope);
  await assert.rejects(f.store.prepare(userId, runId, { ...input, folderId: null }, scope), /REQUEST_CONFLICT/);
  await assert.rejects(f.store.prepare(userId, runId, { ...input, requestKey: 'another' }, scope), /ALREADY_BOUND/);
  await assert.rejects(f.store.prepare(userId, id(8), input, scope), /ALREADY_BOUND/);
  assert.equal(f.records.length, 1);
});

test('执行阶段只读复核不写记录；换目的地或失效来源同样拒绝', async () => {
  const f = fixture();
  await f.store.prepare(userId, runId, input, scope);
  const binding = await f.store.verify(userId, runId, input, scope);
  assert.equal(binding.threadId, threadId);
  assert.equal(binding.artifactVersionId, versionId);
  // 复核可重复执行且结果稳定；不新增记录、不预留第二个文档 ID。
  assert.deepEqual(await f.store.verify(userId, runId, input, scope), binding);
  assert.equal(f.records.length, 1);
  await assert.rejects(f.store.verify(userId, runId, { ...input, folderId: null }, scope), /REQUEST_CONFLICT/);
  f.state.source = false;
  await assert.rejects(f.store.verify(userId, runId, input, scope), /RESOURCE_NOT_ALLOWED/);
});

test('无权版本、提纲、终态 Run、失效目录和来源都不能创建保存绑定', async () => {
  for (const key of ['owned', 'draft', 'active', 'folder', 'source'] as const) {
    const f = fixture(); f.state[key] = false;
    await assert.rejects(f.store.prepare(userId, runId, input, scope));
    assert.equal(f.records.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.store.prepare(userId, runId, { ...input, folderId: null }, { ...scope, allowOwnedLibrary: false }), /RESOURCE_NOT_ALLOWED/);
  await f.store.prepare(userId, runId, input, scope);
  f.state.source = false;
  await assert.rejects(f.store.prepare(userId, runId, input, scope), /RESOURCE_NOT_ALLOWED/);
});
