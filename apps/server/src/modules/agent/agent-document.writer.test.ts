/** 原子写入入口的离线装配测试；真实 SQL 事务/确认/并发仍由整版数据库验收验证。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { AgentDocumentSaveStore } from './agent-document-save.store';
import { AgentDocumentWriter, createAgentDocumentSnapshot } from './agent-document.writer';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentDocumentSave } from './entity/agent-document-save.entity';
import { ToolAuthorization } from './tools/tool-authorization';
import { ToolCallStore } from './tools/tool-call.store';
import { Document } from '../documents/entity/document.entity';
import { DocSnapshot } from '../sync/entity/doc-snapshot.entity';
import { SyncUpdate } from '../sync/entity/sync-update.entity';

import type { ToolAuthorizationContext } from './tools/tool-authorization';
import type { ToolCatalog } from './tools/tool-catalog';
import type { EntityManager } from 'typeorm';

const id = (n: number) => `${n}1111111-1111-4111-8111-111111111111`;
const user = id(1), run = id(2), callId = id(3), saveId = id(4);
const context = { policy: { principal: { userId: user } }, scope: { allowOwnedLibrary: true, documentIds: [], folderIds: [] } } as unknown as ToolAuthorizationContext;

function fixture() {
  const operations: string[] = [];
  const save = { id: saveId, userId: user, runId: run, threadId: id(5), artifactVersionId: id(6), requestKey: 'save',
    documentId: id(7), folderId: null, digest: 'digest', status: 'PREPARED', savedCallId: null };
  const state = { failSnapshot: false, documentDeleted: false };
  const call = { id: callId, toolName: 'create_document', toolVersion: '1', requiresConfirmation: true, revision: 1,
    input: { saveId, saveDigest: 'digest', folderId: null }, status: 'READY', sideEffect: 'none', attemptCount: 1 };
  const manager = {
    transaction: async (_isolation: string, action: (manager: unknown) => Promise<unknown>) => { operations.push('transaction'); return action(manager); },
    queryRunner: { isTransactionActive: true },
    query: async (sql: string) => {
      operations.push(sql);
      if (sql.includes('FROM users')) return [{ id: user }];
      if (sql.includes('cancelRequested')) return [{ cancelRequested: false }];
      if (sql.includes('toolCallLimit')) return [{ limit: 20, used: 0 }];
      return [];
    },
    getRepository: (entity: unknown) => {
      if (entity === AgentDocumentSave) return { findOneBy: async () => save, update: async () => { operations.push('saved'); return { affected: 1 }; } };
      if (entity === AgentArtifactVersion) return { findOneByOrFail: async () => ({ title: '标题', content: '# 草稿\n正文' }) };
      if (entity === Document) return { insert: async () => { operations.push('document'); }, findOneBy: async () => ({ id: save.documentId, deletedAt: state.documentDeleted ? new Date() : null }) };
      if (entity === SyncUpdate) return { save: async () => { operations.push('sync-update'); return { updateId: 42 }; } };
      if (entity === DocSnapshot) return { insert: async (input: { version: number }) => { assert.equal(input.version, 42); operations.push('snapshot'); if (state.failSnapshot) throw new Error('snapshot failed'); } };
      assert.fail('unexpected entity');
    },
  };
  const root = { transaction: manager.transaction } as unknown as EntityManager;
  const catalog = { resolve: () => ({ definition: { origin: { kind: 'builtin' }, riskLevel: 'L1', requiresConfirmation: true, maxOutputBytes: 1000 }, validateOutput: () => ({ ok: true }) }) } as unknown as ToolCatalog;
  return { writer: new AgentDocumentWriter(root, catalog), operations, save, call, state };
}

test('初始化 Yjs 内容与标题完整，字节数与快照一致', () => {
  const result = createAgentDocumentSnapshot('中文标题', '# 内容\n😀');
  const bytes = Buffer.from(result.snapshot, 'base64');
  assert.equal(bytes.length, result.size);
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, bytes); assert.equal(doc.getText('content').toString(), '# 内容\n😀'); assert.equal(doc.getMap('metadata').get('title'), '中文标题'); }
  finally { doc.destroy(); }
});

test('确认被拒绝时不写文档；成功路径使用同一事务，快照失败不继续结算', async (t) => {
  const f = fixture();
  const recheck = t.mock.method(ToolAuthorization.prototype, 'recheck', async () => { throw new Error('CONFIRMATION_REQUIRED'); });
  await assert.rejects(f.writer.save(user, run, callId, saveId, context), /CONFIRMATION_REQUIRED/);
  assert.ok(!f.operations.includes('document'));
  recheck.mock.mockImplementation(async () => ({ call: f.call as unknown as Awaited<ReturnType<ToolAuthorization['recheck']>>['call'], resources: [] }));
  t.mock.method(AgentDocumentSaveStore.prototype, 'verify', async () => ({
    artifactVersionId: f.save.artifactVersionId, threadId: f.save.threadId, digest: f.save.digest,
  }));
  t.mock.method(ToolCallStore.prototype, 'transition', async (...[_u, _r, _c, _rev, event]: Parameters<ToolCallStore['transition']>) => { f.operations.push(event.type); return f.call; });
  t.mock.method(ToolCallStore.prototype, 'getAttempt', async () => ({ id: id(8) }));
  f.operations.length = 0;
  assert.deepEqual(await f.writer.save(user, run, callId, saveId, context), { documentId: f.save.documentId });
  assert.equal(f.operations.filter((op) => op === 'transaction').length, 1);
  assert.ok(f.operations.indexOf('snapshot') < f.operations.indexOf('SUCCEEDED'));
  assert.ok(f.operations.some((op) => op.includes('INSERT INTO agent_tool_results')));
  f.operations.length = 0;
  f.state.failSnapshot = true;
  await assert.rejects(f.writer.save(user, run, callId, saveId, context), /snapshot failed/);
  assert.ok(!f.operations.includes('saved'));
  assert.ok(!f.operations.includes('SUCCEEDED'));
});

test('已提交同调用返回原文档，目标删除后不重建，不同调用不能冒领结果', async (t) => {
  const f = fixture();
  f.save.status = 'SAVED';
  Object.assign(f.save, { savedCallId: callId });
  t.mock.method(ToolCallStore.prototype, 'get', async () => ({ status: 'SUCCEEDED', sideEffect: 'committed' }));
  assert.deepEqual(await f.writer.save(user, run, callId, saveId, context), { documentId: f.save.documentId });
  assert.ok(!f.operations.includes('document'));
  f.state.documentDeleted = true;
  await assert.rejects(f.writer.save(user, run, callId, saveId, context), /DOCUMENT_UNAVAILABLE/);
  await assert.rejects(f.writer.save(user, run, id(9), saveId, context), /INCONSISTENT/);
});
