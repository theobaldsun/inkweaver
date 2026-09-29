import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteAgentData, lockAgentOwner } from './agent-data.cleanup';

import type { EntityManager } from 'typeorm';

function setup(results: unknown[], active = true) {
  const calls: { sql: string; params: unknown }[] = [];
  const manager = { queryRunner: { isTransactionActive: active }, query: async (sql: string, params: unknown) => {
    calls.push({ sql, params });
    return results.shift();
  } } as unknown as EntityManager;
  return { manager, calls };
}

test('未结束 Run 阻止删除；先取得用户锁', async () => {
  const { manager, calls } = setup([[{ id: 'u' }], { unused: true }]);
  // 单独验证锁不会在事务外被误用。
  await lockAgentOwner(manager, 'u');
  assert.match(calls[0]!.sql, /FOR UPDATE/);
  const busy = setup([[{ id: 'u' }], [{ runs: true, events: true }], [{ id: 'run' }]]);
  await assert.rejects(deleteAgentData(busy.manager, 'u'), /未结束/);
  assert.equal(busy.calls.some((call) => call.sql.startsWith('DELETE')), false);
});

test('仅删除指定用户 Run；未迁移环境不执行删除', async () => {
  const ready = setup([[{ id: 'u' }], [{ runs: true, events: true }], [], []]);
  await deleteAgentData(ready.manager, 'u');
  assert.equal(ready.calls.at(-1)?.sql, 'DELETE FROM agent_runs WHERE "userId" = $1');
  assert.deepEqual(ready.calls.at(-1)?.params, ['u']);
  const absent = setup([[{ id: 'u' }], [{ runs: false, events: false }]]);
  await deleteAgentData(absent.manager, 'u');
  assert.equal(absent.calls.length, 2);
});


test('会话结构存在时先删除 Run 再删除 Thread，消息由外键级联', async () => {
  const ready = setup([[{ id: 'u' }], [{ runs: true, events: true, threads: true, messages: true }], [], [], []]);
  await deleteAgentData(ready.manager, 'u');
  assert.equal(ready.calls.at(-2)?.sql, 'DELETE FROM agent_runs WHERE "userId" = $1');
  assert.equal(ready.calls.at(-1)?.sql, 'DELETE FROM agent_threads WHERE "userId" = $1');
  assert.deepEqual(ready.calls.at(-1)?.params, ['u']);
});

test('事务外、用户不存在及不完整结构均拒绝', async () => {
  const outside = setup([], false);
  await assert.rejects(deleteAgentData(outside.manager, 'u'), /AGENT_TRANSACTION_REQUIRED/);
  assert.equal(outside.calls.length, 0);
  await assert.rejects(deleteAgentData(setup([[]]).manager, 'u'), /AGENT_OWNER_UNAVAILABLE/);
  await assert.rejects(deleteAgentData(setup([[{ id: 'u' }], [{ runs: false, events: true }]]).manager, 'u'), /INCOMPLETE_AGENT_SCHEMA/);
});
