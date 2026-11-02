import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { Logger } from '@nestjs/common';

import { AgentRunStreamPoller } from './agent-run-stream.poller';
import type { AgentRunStreamPollerOptions } from './agent-run-stream.poller';
import type { AgentEventReader } from './agent-event.reader';
import type { AgentEventRecord, AgentEventPage } from './agent-event.reader';

const userId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';

function event(sequence: number): AgentEventRecord {
  return { id: `event-${sequence}`, runId, sequence, createdAt: new Date(0).toISOString(),
    body: { type: 'RUN_CREATED', schemaVersion: 1, payload: { status: 'CREATED', revision: 0 } } } as AgentEventRecord;
}

function page(sequences: number[], hasMore: boolean, nextAfter?: number): AgentEventPage {
  const events = sequences.map(event);
  // 缺省取本页最后一条序号；空页默认 0，调用方可显式传入"游标不变"的期望值。
  return { events, nextAfter: nextAfter ?? events.at(-1)?.sequence ?? 0, hasMore };
}

/** 推进假定时器后刷新微任务：轮询链挂在 await 上，必须给一次宏任务边界才能续跑。 */
const flush = (): Promise<void> => new Promise<void>((resolve) => { setImmediate(resolve); });

/**
 * 把下行调用记录下来，并把每次读库变成"已登记、未决"的 Promise，
 * 从而可以在 await 悬停期间插入 stop()——这正是第二轮 stopped 检查要覆盖的窗口。
 *
 * `enqueued` 与 `invoked` 分开记账：前者是测试预先批准的查询次数，后者是真实发生的次数。
 * 计划外查询（重复启动、取消后又排下一轮）会让两者不一致，断言才真正有效。
 */
function harness(overrides: Partial<AgentRunStreamPollerOptions> = {}) {
  const pushed: { id?: string; type: string }[] = [];
  const completed = { value: false };
  const failed: Error[] = [];
  const enqueued: { resolve: ((value: AgentEventPage) => void) | null; reject: ((reason: unknown) => void) | null }[] = [];
  const invoked: { cursor: number | null; limit: number | null }[] = [];
  const reader = {
    async list(_u: string, _r: string, after: number, limit: number): Promise<AgentEventPage> {
      const approved = enqueued.at(-1);
      assert.ok(approved, 'reader.list 应为测试预先登记的查询');
      invoked.push({ cursor: after, limit });
      return new Promise<AgentEventPage>((resolve, reject) => { approved.resolve = resolve; approved.reject = reject; });
    },
  } as unknown as AgentEventReader;
  const options: AgentRunStreamPollerOptions = {
    sink: {
      next: (message) => pushed.push(message as { id?: string; type: string }),
      error: (error) => failed.push(error as Error),
      complete: () => { completed.value = true; },
    },
    reader, userId, runId, cursor: 0, deadline: Number.MAX_SAFE_INTEGER, ...overrides,
  };
  return {
    pushed, completed, failed, invoked, enqueued, options,
    /** 预先批准一次查询。 */
    enqueue: () => { enqueued.push({ resolve: null, reject: null }); },
    /** 让第 index 次（从 0 计）真实查询拿到结果。 */
    resolve: (index: number, result: AgentEventPage) => { enqueued[index]?.resolve?.(result); },
    /** 让第 index 次真实查询失败。 */
    reject: (index: number, reason: unknown) => { enqueued[index]?.reject?.(reason); },
  };
}

test.beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'] }); });
test.afterEach(() => { mock.timers.reset(); });

test('取一批即推全部事件：id 为事件序号，类型固定 agent', async () => {
  const h = harness();
  h.enqueue();
  new AgentRunStreamPoller(h.options).start();
  assert.equal(h.invoked.length, 1, 'start 应立刻发起第一轮查询');
  h.resolve(0, page([1, 2, 3], false));
  await flush();
  assert.equal(h.pushed.length, 3);
  assert.deepEqual(h.pushed.map((m) => m.id), ['1', '2', '3']);
  assert.ok(h.pushed.every((m) => m.type === 'agent'));
});

test('空页发心跳且不带 id，避免推进客户端的 Last-Event-ID', async () => {
  const h = harness();
  h.enqueue();
  new AgentRunStreamPoller(h.options).start();
  h.resolve(0, page([], false));
  await flush();
  assert.equal(h.pushed.length, 1);
  assert.equal(h.pushed[0]?.type, 'heartbeat');
  assert.equal(h.pushed[0]?.id, undefined);
});

test('节奏：还有更多则 0 秒立即再拉，空闲则等满 1 秒', async () => {
  const h = harness();
  h.enqueue();
  new AgentRunStreamPoller(h.options).start();
  h.resolve(0, page([1], true));
  await flush();
  h.enqueue();
  mock.timers.tick(1);
  await flush();
  assert.equal(h.invoked.length, 2, '0 秒档应已发起第二轮');
  assert.equal(h.invoked[1]?.cursor, 1, '第二轮应接着本页最后一条序号');
  h.resolve(1, page([2], false));
  await flush();
  assert.equal(h.invoked.length, 2);
  mock.timers.tick(999);
  await flush();
  assert.equal(h.invoked.length, 2, '空闲档 1 秒内不应提前查询');
  h.enqueue();
  mock.timers.tick(1);
  await flush();
  assert.equal(h.invoked.length, 3, '空闲档等满 1 秒后才查询');
});

test('游标与批量大小按配置传入 reader，且游标随本页推进', async () => {
  const h = harness({ cursor: 7, batchSize: 25 });
  h.enqueue();
  new AgentRunStreamPoller(h.options).start();
  assert.equal(h.invoked[0]?.cursor, 7);
  assert.equal(h.invoked[0]?.limit, 25);
  h.resolve(0, page([8, 9], true));
  await flush();
  h.enqueue();
  mock.timers.tick(1);
  await flush();
  assert.equal(h.invoked[1]?.cursor, 9, '游标应推进到本页最后一条序号');
});

test('空页保持游标不回退', async () => {
  const h = harness({ cursor: 42 });
  h.enqueue();
  new AgentRunStreamPoller(h.options).start();
  h.resolve(0, page([], false, 42));
  await flush();
  h.enqueue();
  mock.timers.tick(1000);
  await flush();
  assert.equal(h.invoked.length, 2);
  assert.equal(h.invoked[1]?.cursor, 42);
});

test('start 幂等：重复调用只发起一轮查询', async () => {
  const h = harness();
  h.enqueue();
  const poller = new AgentRunStreamPoller(h.options);
  poller.start();
  poller.start();
  poller.start();
  assert.equal(h.invoked.length, 1, '重复 start 不应增加查询');
  h.resolve(0, page([1], false));
  await flush();
  assert.equal(h.pushed.length, 1);
});

test('await 中途取消：不再排下一轮，也不再发起查询', async () => {
  const h = harness();
  h.enqueue();
  const poller = new AgentRunStreamPoller(h.options);
  poller.start();
  poller.stop();                                    // 读库尚未 resolve 时取消
  h.resolve(0, page([1, 2], true));
  mock.timers.tick(60_000);
  await flush();
  assert.equal(h.invoked.length, 1, '取消后不应再发起任何查询');
  assert.equal(h.failed.length, 0, 'stop() 是正常取消，不应下发错误');
});

test('stop 幂等，并清掉尚未触发的定时器', async () => {
  const h = harness();
  h.enqueue();
  const poller = new AgentRunStreamPoller(h.options);
  poller.start();
  h.resolve(0, page([1], false));
  await flush();                                    // 已排定 1 秒后的下一轮
  poller.stop();
  poller.stop();
  mock.timers.tick(60_000);
  await flush();
  assert.equal(h.invoked.length, 1, '定时器应已被清掉');
});

test('到点主动 complete，且不再查询', async () => {
  const h = harness({ deadline: Date.now() + 10 });
  h.enqueue();
  new AgentRunStreamPoller(h.options).start();
  h.resolve(0, page([1], true));
  await flush();
  assert.equal(h.completed.value, false, '尚未到点应继续轮询');
  h.enqueue();
  mock.timers.tick(11);
  await flush();
  assert.equal(h.completed.value, true);
  assert.equal(h.invoked.length, 1);
  assert.equal(h.failed.length, 0);
});

test('读失败只下发稳定码、保留 cause 并写日志，同时停止轮询', async () => {
  const warnings: string[] = [];
  const original = Logger.prototype.warn;
  Logger.prototype.warn = function warn(this: unknown, message: unknown) { warnings.push(String(message)); } as typeof original;
  try {
    const h = harness();
    h.enqueue();
    new AgentRunStreamPoller(h.options).start();
    const boom = new Error('database unavailable');
    h.reject(0, boom);
    mock.timers.tick(10_000);
    await flush();
    assert.equal(h.failed.length, 1);
    const sent = h.failed[0] as Error & { cause?: unknown };
    assert.equal(sent.message, 'AGENT_STREAM_UNAVAILABLE');
    assert.equal(sent.cause, boom, '原始错误应通过 cause 保留，便于排障');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /runId=22222222-2222-4222-8222-222222222222/);
    assert.match(warnings[0] ?? '', /database unavailable/);
    assert.equal(h.invoked.length, 1, '失败后不应继续轮询');
    assert.equal(h.completed.value, false);
  } finally {
    Logger.prototype.warn = original;
  }
});

test('读失败但已取消时不再下发错误', async () => {
  const h = harness();
  h.enqueue();
  const poller = new AgentRunStreamPoller(h.options);
  poller.start();
  poller.stop();
  h.reject(0, new Error('database unavailable'));
  mock.timers.tick(10_000);
  await flush();
  assert.equal(h.invoked.length, 1);
  assert.equal(h.failed.length, 0);
});
