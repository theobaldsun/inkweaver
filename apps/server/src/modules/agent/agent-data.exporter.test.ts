import assert from 'node:assert/strict';
import test from 'node:test';

import { exportAgentData } from './agent-data.exporter';

import type { EntityManager } from 'typeorm';

/** 仅模拟事务边界和查询返回值，不声称验证真实 PostgreSQL 隔离性。 */
function fixture(results: unknown[]) {
  const calls: { sql: string; parameters: unknown }[] = [];
  const transaction = { query: async (sql: string, parameters: unknown) => {
    calls.push({ sql, parameters });
    const result = results.shift();
    if (result instanceof Error) throw result;
    return result;
  } };
  const manager = { transaction: async (isolation: string, action: (value: unknown) => Promise<unknown>) => {
    assert.equal(isolation, 'REPEATABLE READ');
    return action(transaction);
  } } as unknown as EntityManager;
  return { manager, calls };
}

test('未迁移与只迁移 Run 的环境仍可导出', async () => {
  const missing = fixture([[{ runs: false, events: false }]]);
  assert.deepEqual(await exportAgentData(missing.manager, 'user'), { documentSaves: [], artifacts: [], artifactVersions: [], artifactSources: [], modelCalls: [], checkpoints: [], sources: [], threads: [], messages: [], runs: [], events: [], toolCalls: [], toolAttempts: [], confirmations: [], toolResults: [], budgetReservations: [] });
  assert.equal(missing.calls.length, 1);
  const partial = fixture([[{ runs: true, events: false }], [{ goal: 'test' }]]);
  assert.deepEqual(await exportAgentData(partial.manager, 'user'), { documentSaves: [], artifacts: [], artifactVersions: [], artifactSources: [], modelCalls: [], checkpoints: [], sources: [], threads: [], messages: [], runs: [{ goal: 'test' }], events: [], toolCalls: [], toolAttempts: [], confirmations: [], toolResults: [], budgetReservations: [] });
});

test('所有数据查询限定用户；事件只输出校验后的正文及公开元数据', async () => {
  const event = { id: 'event', runId: 'run', sequence: 1, createdAt: new Date(), schemaVersion: 1,
    type: 'RUN_CREATED', payload: { status: 'CREATED', revision: 0 }, internal: 'not exported' };
  const { manager, calls } = fixture([[{ runs: true, events: true }], [], [event]]);
  const result = await exportAgentData(manager, 'user');
  assert.equal(result.events.length, 1);
  assert.ok(!Object.hasOwn(result.events[0] as object, 'internal'));
  for (const call of calls.slice(1)) {
    assert.match(call.sql, /"userId"\s*=\s*\$1/);
    assert.deepEqual(call.parameters, ['user']);
  }
});

test('不完整结构、数据库错误与未知事件不伪装成成功空导出', async () => {
  const broken = fixture([[{ runs: false, events: true }]]);
  await assert.rejects(exportAgentData(broken.manager, 'user'), /INCOMPLETE_AGENT_SCHEMA/);
  const failed = fixture([[{ runs: true, events: true }], new Error('query failed')]);
  await assert.rejects(exportAgentData(failed.manager, 'user'), /query failed/);
  const invalid = fixture([[{ runs: true, events: true }], [], [{ type: 'UNKNOWN' }]]);
  await assert.rejects(exportAgentData(invalid.manager, 'user'), /INVALID_AGENT_EVENT/);
});

test('调用记录在同一事务内按用户导出，不依赖事件表存在', async () => {
  const call = { id: 'call', runId: 'run', toolName: 'read_document', input: { docId: 'doc' } };
  for (const events of [false, true]) {
    const { manager, calls } = fixture([[{ runs: true, events, calls: true }], [], [call], []]);
    const result = await exportAgentData(manager, 'owner');
    assert.deepEqual(result.toolCalls, [call]);
    assert.ok(calls[2]);
    assert.match(calls[2].sql, /r.id = c\."runId" AND r\."userId" = c\."userId"/);
    assert.match(calls[2].sql, /WHERE r\."userId" = \$1/);
    assert.match(calls[2].sql, /ORDER BY c\."runId", c\."createdAt", c.id/);
    assert.ok(!calls[2].sql.includes('SELECT *'));
    assert.deepEqual(calls[2].parameters, ['owner']);
  }
});

test('孤立调用表与调用查询失败不能返回部分成功结果', async () => {
  const broken = fixture([[{ runs: false, events: false, calls: true }]]);
  await assert.rejects(exportAgentData(broken.manager, 'user'), /INCOMPLETE_AGENT_SCHEMA/);
  const failed = fixture([[{ runs: true, events: false, calls: true }], [], new Error('calls query failed')]);
  await assert.rejects(exportAgentData(failed.manager, 'user'), /calls query failed/);
});


test('尝试历史按归属导出；缺少父表或查询失败不能静默遗漏', async () => {
  const row = { id: 'attempt', callId: 'call', attemptNumber: 1, status: 'FAILED' };
  const good = fixture([[{ runs: true, events: false, calls: true, attempts: true }], [], [], [row]]);
  assert.deepEqual((await exportAgentData(good.manager, 'owner')).toolAttempts, [row]);
  assert.match(good.calls[3]!.sql, /c\."userId" = a\."userId"/);
  assert.deepEqual(good.calls[3]!.parameters, ['owner']);
  const broken = fixture([[{ runs: true, events: false, calls: false, attempts: true }]]);
  await assert.rejects(exportAgentData(broken.manager, 'owner'), /INCOMPLETE_AGENT_SCHEMA/);
  const failed = fixture([[{ runs: true, events: false, calls: true, attempts: true }], [], [], new Error('attempt query failed')]);
  await assert.rejects(exportAgentData(failed.manager, 'owner'), /attempt query failed/);
});


test('会话迁移后导出 Thread、可见消息与 Run 触发关系，但不导出请求摘要', async () => {
  const thread = { id: 'thread', userId: 'owner', title: '会话' };
  const message = { id: 'message', threadId: 'thread', role: 'user', requestKey: 'request-1', runId: 'run' };
  const run = { id: 'run', threadId: 'thread', triggerMessageId: 'message' };
  const { manager, calls } = fixture([
    [{ runs: true, events: false, threads: true, messages: true }],
    [thread], [message], [run],
  ]);
  const result = await exportAgentData(manager, 'owner');
  assert.deepEqual(result.threads, [thread]);
  assert.deepEqual(result.messages, [message]);
  assert.deepEqual(result.runs, [run]);
  assert.match(calls[2]!.sql, /m\."requestKey"/);
  assert.ok(!calls[2]!.sql.includes('requestDigest'));
  assert.match(calls[3]!.sql, /"triggerMessageId"/);
  assert.deepEqual(calls[1]!.parameters, ['owner']);
  assert.deepEqual(calls[2]!.parameters, ['owner']);
});


test('来源导出按 Run 和用户归属过滤，孤立来源表拒绝导出', async () => {
  const row = { id: 'source', excerpt: '资料', usedInContext: true };
  const good = fixture([[{ runs: true, sources: true }], [], [row]]);
  assert.deepEqual((await exportAgentData(good.manager, 'owner')).sources, [row]);
  assert.match(good.calls[2]!.sql, /r\."userId"=s\."userId"/);
  assert.deepEqual(good.calls[2]!.parameters, ['owner']);
  const broken = fixture([[{ runs: false, sources: true }]]);
  await assert.rejects(exportAgentData(broken.manager, 'owner'), /INCOMPLETE_AGENT_SCHEMA/);
});


test('Checkpoint 与业务记录同快照导出，并按用户归属限制框架数据', async () => {
  const row = { runId: 'run', checkpoints: [], blobs: [{ blobBase64: 'YQ==' }], writes: [] };
  const good = fixture([[{ runs: true, checkpoints: true }], [], [row]]);
  assert.deepEqual((await exportAgentData(good.manager, 'owner')).checkpoints, [row]);
  assert.match(good.calls[2]!.sql, /WHERE r\."userId"=\$1/);
  assert.deepEqual(good.calls[2]!.parameters, ['owner']);
  const broken = fixture([[{ runs: false, checkpoints: true }]]);
  await assert.rejects(exportAgentData(broken.manager, 'owner'), /INCOMPLETE_AGENT_SCHEMA/);
});


test('模型审计按用户归属导出，不把 null 用量变成零', async () => {
  const row = { id: 'call', totalTokens: null, status: 'STARTED' };
  const good = fixture([[{ runs: true, models: true }], [], [row]]);
  assert.deepEqual((await exportAgentData(good.manager, 'owner')).modelCalls, [row]);
  assert.match(good.calls[2]!.sql, /r\."userId"=m\."userId"/);
  assert.deepEqual(good.calls[2]!.parameters, ['owner']);
  await assert.rejects(exportAgentData(fixture([[{ runs: false, models: true }]]).manager, 'owner'), /INCOMPLETE_AGENT_SCHEMA/);
});


test('成果、版本和引用按用户一起导出，不完整成果结构拒绝导出', async () => {
  const flags = { runs: true, threads: true, messages: true, sources: true, artifacts: true, artifactVersions: true, artifactSources: true };
  const f = fixture([[flags], [], [], [], [], [{ id: 'artifact' }], [{ version: 1 }], [{ label: 'S1' }]]);
  const result = await exportAgentData(f.manager, 'owner');
  assert.deepEqual(result.artifacts, [{ id: 'artifact' }]);
  assert.deepEqual(result.artifactVersions, [{ version: 1 }]);
  assert.deepEqual(result.artifactSources, [{ label: 'S1' }]);
  for (const call of f.calls.slice(-3)) {
    assert.match(call.sql, /WHERE "userId"=\$1/);
    assert.deepEqual(call.parameters, ['owner']);
  }
  const broken = fixture([[{ ...flags, artifactSources: false }]]);
  await assert.rejects(exportAgentData(broken.manager, 'owner'), /INCOMPLETE_AGENT_SCHEMA/);
});


test('保存绑定按用户导出，缺少成果版本表不能静默遗漏', async () => {
  const flags = { runs: true, threads: true, messages: true, sources: true, artifacts: true, artifactVersions: true, artifactSources: true, documentSaves: true };
  const f = fixture([[flags], [], [], [], [], [], [], [], [{ status: 'PREPARED', documentId: 'reserved' }]]);
  assert.deepEqual((await exportAgentData(f.manager, 'owner')).documentSaves, [{ status: 'PREPARED', documentId: 'reserved' }]);
  assert.deepEqual(f.calls.at(-1)?.parameters, ['owner']);
  assert.match(f.calls.at(-1)!.sql, /WHERE "userId"=\$1/);
  await assert.rejects(exportAgentData(fixture([[{ runs: true, documentSaves: true }]]).manager, 'owner'), /INCOMPLETE_AGENT_SCHEMA/);
});
