/** 离线验证业务分支和事务调用；真实约束、回滚及并发由整版 PostgreSQL 验收覆盖。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentArtifactStore } from './agent-artifact.store';
import { AgentArtifactSource } from './entity/agent-artifact-source.entity';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentArtifact } from './entity/agent-artifact.entity';

import type { PublishAgentArtifact } from './agent-artifact.store';
import type { EntityManager } from 'typeorm';

const user = '10000000-0000-0000-0000-000000000001';
const run = '20000000-0000-0000-0000-000000000001';
const thread = '30000000-0000-0000-0000-000000000001';
const artifact = '40000000-0000-0000-0000-000000000001';
const source = '50000000-0000-0000-0000-000000000001';
const scope = { allowOwnedLibrary: true, documentIds: [], folderIds: [] };
const input: PublishAgentArtifact = { artifactId: artifact, expectedVersion: 0, kind: 'outline', title: '提纲', content: '事实 [S1]', citations: [{ label: 'S1', sourceId: source }] };

function fixture() {
  const parents: Record<string, unknown>[] = [];
  const versions: AgentArtifactVersion[] = [];
  const citations: AgentArtifactSource[] = [];
  const state = { available: true, thread, sourceAllowed: true, sourceLabel: 'S1', deleted: false, failLinks: false };
  const matches = (row: object, where: object) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  const repository = (rows: object[]) => ({
    findOneBy: async (where: object) => rows.find((row) => matches(row, where)) ?? null,
    findOneByOrFail: async (where: object) => { const row = rows.find((item) => matches(item, where)); assert.ok(row); return row; },
    findOne: async ({ where }: { where: object }) => [...rows].reverse().find((row) => matches(row, where)) ?? null,
    find: async ({ where }: { where: object }) => rows.filter((row) => matches(row, where)),
    countBy: async (where: object) => rows.filter((row) => matches(row, where)).length,
    insert: async (value: object | object[]) => { if (rows === citations && state.failLinks) throw new Error('link failure'); rows.push(...(Array.isArray(value) ? value : [value])); },
  });
  const manager = {
    queryRunner: { isTransactionActive: true },
    transaction: async (_isolation: string, action: (manager: unknown) => Promise<unknown>) => action(manager),
    getRepository: (type: unknown) => repository(type === AgentArtifact ? parents : type === AgentArtifactVersion ? versions : type === AgentArtifactSource ? citations : assert.fail('unexpected entity')),
    query: async (sql: string) => {
      if (sql.includes('FROM users')) return [{ id: user }];
      if (sql.includes('FROM agent_runs')) return state.available ? [{ threadId: state.thread }] : [];
      if (sql.includes('FROM agent_run_sources')) return state.sourceAllowed ? [{ id: source, docId: source, citationLabel: state.sourceLabel }] : [];
      if (sql.includes('FROM documents')) return state.deleted ? [] : [{ title: '来源', content: '事实', folderId: null }];
      assert.fail(sql);
    },
  } as unknown as EntityManager;
  return { store: new AgentArtifactStore(manager), parents, versions, citations, state };
}

test('提纲追加为草稿，支持同一会话的新 Run；历史正文和引用不被改写', async () => {
  const f = fixture();
  const first = await f.store.publish(user, run, input, scope);
  const next = await f.store.publish(user, source, { ...input, expectedVersion: 1, kind: 'draft', content: '完整草稿 [S1]' }, scope);
  assert.equal(first.version, 1);
  assert.equal(next.version, 2);
  assert.equal(next.runId, source);
  assert.equal(f.versions[0]?.content, input.content);
  assert.equal(f.parents.length, 1);
  assert.equal(f.citations.length, 2);
  assert.equal((await f.store.readVersion(user, artifact, 1))?.version.id, first.id);
  assert.equal(await f.store.readVersion(source, artifact, 1), null);
});

test('同内容重放不追加，过期基准的不同内容及不同 Run 不复用旧版本', async () => {
  const f = fixture();
  const first = await f.store.publish(user, run, input, scope);
  await f.store.publish(user, run, { ...input, expectedVersion: 1, content: '新版 [S1]' }, scope);
  assert.equal((await f.store.publish(user, run, input, scope)).id, first.id);
  assert.equal(f.versions.length, 2);
  await assert.rejects(f.store.publish(user, run, { ...input, content: '变化 [S1]' }, scope), /VERSION_CONFLICT/);
  await assert.rejects(f.store.publish(user, source, input, scope), /VERSION_CONFLICT/);
  await assert.rejects(f.store.publish(user, run, { ...input, expectedVersion: 3 }, scope), /VERSION_CONFLICT/);
});

test('Run、会话、用户与来源权限受限，失败不发布版本', async () => {
  for (const scenario of ['run', 'source', 'label', 'deleted', 'scope']) {
    const f = fixture();
    if (scenario === 'run') f.state.available = false;
    if (scenario === 'source') f.state.sourceAllowed = false;
    if (scenario === 'label') f.state.sourceLabel = 'S2';
    if (scenario === 'deleted') f.state.deleted = true;
    await assert.rejects(f.store.publish(user, run, input, scenario === 'scope' ? { ...scope, allowOwnedLibrary: false } : scope));
    assert.equal(f.versions.length, 0);
    assert.equal(f.parents.length, 0);
  }
  const f = fixture();
  await f.store.publish(user, run, input, scope);
  f.state.thread = source;
  await assert.rejects(f.store.publish(user, run, { ...input, expectedVersion: 1 }, scope), /NOT_AVAILABLE/);
  await assert.rejects(f.store.publish(source, run, input, scope), /NOT_AVAILABLE/);
});

test('空白、超字节正文、未知引用、非法版本与超额成果拒绝，引用写失败向上传播', async () => {
  const f = fixture();
  for (const change of [{ content: ' ' }, { content: '中'.repeat(90000) }, { content: '[S2]' }, { expectedVersion: 50 }, { expectedVersion: -1 }, { title: '\0' }]) {
    await assert.rejects(f.store.publish(user, run, { ...input, ...change }, scope));
  }
  assert.equal(f.parents.length, 0);
  f.parents.push(...Array.from({ length: 20 }, (_, id) => ({ id, userId: user, threadId: thread })));
  await assert.rejects(f.store.publish(user, run, input, scope), /ARTIFACT_LIMIT/);
  const broken = fixture();
  broken.state.failLinks = true;
  await assert.rejects(broken.store.publish(user, run, input, scope), /link failure/);
});

test('未引用的候选不写入版本关系；重放也重新检查来源权限', async () => {
  const f = fixture();
  await f.store.publish(user, run, { ...input, content: '没有引用' }, scope);
  assert.equal(f.citations.length, 0);
  const other = fixture();
  await other.store.publish(user, run, input, scope);
  other.state.deleted = true;
  await assert.rejects(other.store.publish(user, run, input, scope), /RESOURCE_NOT_ALLOWED/);
});


test('证据问题的来源参与权限检查与版本引用，报告改变不能复用旧提交', async () => {
  const f = fixture();
  const evidence = { schemaVersion: 1, status: 'unverified', items: [{ type: 'gap', description: '缺少佐证', sourceLabels: ['S1'] }] };
  const request = { ...input, content: '没有正文引用', evidence };
  const saved = await f.store.publish(user, run, request, scope);
  assert.deepEqual(saved.evidence, evidence);
  assert.equal(f.citations.length, 1);
  assert.equal((await f.store.publish(user, run, request, scope)).id, saved.id);
  await assert.rejects(f.store.publish(user, run, { ...request, evidence: { ...evidence, items: [] } }, scope), /VERSION_CONFLICT/);
  const revoked = fixture();
  revoked.state.deleted = true;
  await assert.rejects(revoked.store.publish(user, run, request, scope), /RESOURCE_NOT_ALLOWED/);
  assert.equal(revoked.versions.length, 0);
});
