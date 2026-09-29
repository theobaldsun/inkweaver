import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentEventReader } from './agent-event.reader';

const userId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const row = { id: runId, runId, sequence: 2, createdAt: new Date('2026-09-15T00:00:00Z'),
  type: 'RUN_CREATED', schemaVersion: 1, payload: { status: 'CREATED', revision: 0 } };

test('查询绑定归属和排他游标，多取一条但不越过未返回事件', async () => {
  const reader = new AgentEventReader({ query: async (sql, parameters) => {
    assert.match(sql, /r\."userId" = \$1 AND r.id = \$2 AND e.sequence > \$3/);
    assert.match(sql, /ORDER BY e.sequence ASC LIMIT \$4/);
    assert.deepEqual(parameters, [userId, runId, 1, 2]);
    return [row, { ...row, sequence: 3 }];
  } });
  const page = await reader.list(userId, runId, 1, 1);
  assert.equal(page.events.length, 1);
  assert.equal(page.nextAfter, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.events[0]?.createdAt, '2026-09-15T00:00:00.000Z');
  assert.notEqual(page.events[0]?.body.payload, row.payload);
});

test('空页保留游标；末页返回最后实际序号，允许序号有间隔', async () => {
  const empty = new AgentEventReader({ query: async () => [] });
  assert.deepEqual(await empty.list(userId, runId, 8), { events: [], nextAfter: 8, hasMore: false });
  const reader = new AgentEventReader({ query: async () => [{ ...row, sequence: 9 }] });
  const page = await reader.list(userId, runId, 3);
  assert.equal(page.nextAfter, 9);
  assert.equal(page.hasMore, false);
});

test('非法参数在数据库访问前拒绝', async () => {
  const reader = new AgentEventReader({ query: async () => { assert.fail('不应查询'); } });
  await assert.rejects(reader.list('', runId), /INVALID_AGENT_EVENT_QUERY/);
  for (const after of [-1, 0.5, NaN, 2147483648]) await assert.rejects(reader.list(userId, runId, after), /INVALID_AGENT_EVENT_QUERY/);
  for (const limit of [0, 101, 1.5]) await assert.rejects(reader.list(userId, runId, 0, limit), /INVALID_AGENT_EVENT_QUERY/);
});

test('不静默跳过未知事件；数据库错误向上层传播', async () => {
  const reader = new AgentEventReader({ query: async () => [{ ...row, type: 'UNKNOWN' }] });
  await assert.rejects(reader.list(userId, runId), /INVALID_AGENT_EVENT/);
  const failing = new AgentEventReader({ query: async () => { throw new Error('database unavailable'); } });
  await assert.rejects(failing.list(userId, runId), /database unavailable/);
});
