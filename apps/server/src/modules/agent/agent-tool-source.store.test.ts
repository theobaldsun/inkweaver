import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateAgentTokens } from './agent-context';
import { AgentToolSourceStore, readDocumentSource } from './agent-tool-source.store';

import type { EntityManager } from 'typeorm';

const user = '11111111-1111-1111-1111-111111111111';
const run = '22222222-2222-2222-2222-222222222222';
const call = '33333333-3333-3333-3333-333333333333';
const doc = '44444444-4444-4444-4444-444444444444';
const output = { id: doc, title: '标题', content: '文'.repeat(3000), version: 'a'.repeat(64) };

test('工具片段限制与身份绑定；内容版本不冒充时间', () => {
  const source = readDocumentSource(output, doc);
  assert.ok(estimateAgentTokens(source.excerpt) <= 1500);
  assert.equal(source.documentVersion, output.version);
  assert.throws(() => readDocumentSource(output, user), /INVALID_TOOL_SOURCE_RESULT/);
  assert.throws(() => readDocumentSource({ ...output, version: '未知' }, doc), /INVALID_TOOL_SOURCE_RESULT/);
  assert.equal(readDocumentSource({ ...output, content: '  ' }, doc).excerpt, '');
});

test('追加 S2 不重排 S1；业务已提交而图尚未保存时重放仍返回原来源', async () => {
  let inserted = 0;
  let saved: Record<string, unknown> | undefined;
  const transaction = { queryRunner: { isTransactionActive: true }, query: async (sql: string, parameters: unknown[]) => {
    if (sql.startsWith('SELECT id FROM users') || sql.startsWith('SELECT id FROM agent_runs')) return [{ id: user }];
    if (sql.includes('FROM agent_tool_calls c')) return [{ docId: doc, output }];
    if (sql.includes('AND "toolCallId"=$3')) return saved ? [saved] : [];
    if (sql.startsWith('SELECT "citationLabel"')) return [{ citationLabel: 'S1' }];
    if (sql.startsWith('INSERT')) {
      inserted += 1;
      saved = { id: parameters[0], title: parameters[5], excerpt: parameters[6], documentVersion: parameters[7], citationLabel: parameters[9], usedInContext: true };
      assert.ok(sql.includes('NULL,$8,$9,NULL,true'));
      return [saved];
    }
    throw new Error('unexpected query');
  } };
  const manager = { transaction: async (_isolation: string, action: (value: unknown) => Promise<unknown>) => action(transaction) } as unknown as EntityManager;
  const store = new AgentToolSourceStore(manager);
  const first = await store.captureReadDocument(user, run, call);
  const replay = await store.captureReadDocument(user, run, call);
  assert.deepEqual(replay, first); assert.equal(inserted, 1);
  assert.equal(first.citation?.label, 'S2');
  assert.equal(JSON.parse(first.text).content, saved!.excerpt);
  assert.equal(JSON.parse(first.text).version, output.version);
});
