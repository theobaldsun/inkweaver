/** 共享重试策略与到期复核的离线验证；真实事务竞争与并发仍由整版数据库验收覆盖。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolCallStore } from './tool-call.store';
import { advanceDueRetry, ToolRetryPolicy } from './tool-retry';

import type { ToolRetryTarget } from './tool-retry';
import type { AgentToolCall } from '../entity/agent-tool-call.entity';
import type { EntityManager } from 'typeorm';

const id = (digit: number) => `${digit}1111111-1111-4111-8111-111111111111`;
const userId = id(1), runId = id(2), callId = id(3);
const target: ToolRetryTarget = { userId, runId, callId };

/** 只记录 SQL 与参数的查询桩；返回值由用例按语句决定。 */
function queryStub(rows: (sql: string) => unknown[]) {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = {
    queryRunner: { isTransactionActive: true },
    transaction: async (_isolation: string, action: (value: unknown) => Promise<unknown>) => action(manager),
    query: async (sql: string, parameters: unknown[] = []) => { calls.push({ sql, parameters }); return rows(sql); },
  };
  return { manager: manager as unknown as EntityManager, calls };
}

test('退避为确定性指数增长并受上限约束，次数上限只由策略裁决', () => {
  const policy = new ToolRetryPolicy();
  assert.equal(policy.maxAttempts, 3);
  assert.deepEqual([1, 2, 3, 4].map((count) => policy.delayFor(count)), [250, 500, 1000, 2000]);
  assert.equal(policy.canRetry(2), true);
  assert.equal(policy.canRetry(3), false);
  const capped = new ToolRetryPolicy({ retryBaseDelayMs: 250, retryMaxDelayMs: 300 });
  assert.deepEqual([1, 2, 3].map((count) => capped.delayFor(count)), [250, 300, 300]);
  const single = new ToolRetryPolicy({ maxAttempts: 1, retryBaseDelayMs: 10, retryMaxDelayMs: 20 });
  assert.equal(single.canRetry(1), false);
});

test('非法重试边界只抛出稳定错误码，不回显配置', () => {
  for (const options of [
    { maxAttempts: 0 }, { maxAttempts: 11 }, { maxAttempts: 1.5 },
    { retryBaseDelayMs: 9 }, { retryBaseDelayMs: 30001 },
    { retryMaxDelayMs: 60001 }, { retryBaseDelayMs: 500, retryMaxDelayMs: 400 },
  ]) {
    assert.throws(() => new ToolRetryPolicy(options), /INVALID_RETRY_OPTIONS/, JSON.stringify(options));
  }
  assert.doesNotThrow(() => new ToolRetryPolicy({ maxAttempts: 10, retryBaseDelayMs: 30000, retryMaxDelayMs: 60000 }));
});

test('截止时间写入只作用于 RETRY_WAIT；条件未命中不静默继续', async () => {
  const policy = new ToolRetryPolicy({ retryBaseDelayMs: 10, retryMaxDelayMs: 20 });
  const due = queryStub(() => [{ id: callId }]);
  await policy.schedule(due.manager, target, 2);
  assert.equal(due.calls.length, 1);
  assert.ok(due.calls[0]!.sql.includes("status='RETRY_WAIT'"), '截止时间必须只在退避等待状态写入');
  assert.deepEqual(due.calls[0]!.parameters, [callId, runId, userId, 20]);

  const missed = queryStub(() => []);
  await assert.rejects(policy.schedule(missed.manager, target, 1), /RETRY_SCHEDULE_CONFLICT/);
});

test('到期复核只迁移合法退避等待：已 READY 视为结束，取消或未到期一律不动', async (t) => {
  const call = (status: AgentToolCall['status'], cancelRequested = false) =>
    ({ id: callId, userId, runId, status, cancelRequested, revision: 4,
      // 退避等待必须有数据库截止时间；缺失时不能把“无截止时间”当成“已到期”。
      retryNotBefore: new Date(Date.now() - 1000) } as unknown as AgentToolCall);
  const run = async (state: { call: AgentToolCall | null; due: boolean }) => {
    const stub = queryStub((sql) => sql.includes('FROM users') ? [{ id: userId }] : [{ due: state.due }]);
    const events: string[] = [];
    t.mock.method(ToolCallStore.prototype, 'get', async () => state.call);
    t.mock.method(ToolCallStore.prototype, 'transition', async (...[_u, _r, _c, _rev, event]: Parameters<ToolCallStore['transition']>) => {
      events.push(event.type);
      return state.call!;
    });
    const advanced = await advanceDueRetry(stub.manager, target);
    return { advanced, events, stub };
  };

  // 维护扫描已先推进 READY：退避合法结束，不应被误判为取消，也不重复迁移。
  assert.equal((await run({ call: call('READY'), due: false })).advanced, true);
  assert.deepEqual((await run({ call: call('READY'), due: false })).events, []);
  // 取消请求的调用不能回到 READY。
  assert.equal((await run({ call: call('RETRY_WAIT', true), due: true })).advanced, false);
  assert.equal((await run({ call: call('RETRY_WAIT'), due: false })).advanced, false);
  const advanced = await run({ call: call('RETRY_WAIT'), due: true });
  assert.equal(advanced.advanced, true);
  assert.deepEqual(advanced.events, ['RETRY_DUE']);
  assert.equal((await run({ call: null, due: true })).advanced, false);
  // 取消优先：即使数据库已到期也不迁移。
  assert.equal((await run({ call: call('SUCCEEDED'), due: true })).advanced, false);
});
