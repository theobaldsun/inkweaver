import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource, QueryResult } from 'typeorm';

import { AgentRunTransitionError } from './agent-run-lifecycle';
import { AgentRunStore, AgentRunStoreError } from './agent-run.store';
import { AgentRun } from './entity/agent-run.entity';

/** 只构建真实 TypeORM 元数据和 SQL，不初始化连接，也不读取生产数据源。 */
class OfflineSource extends DataSource {
  async prepare(): Promise<void> { await this.buildMetadatas(); }
}

const userId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';

async function setup(affected = 1) {
  const source = new OfflineSource({ type: 'postgres', entities: [AgentRun], synchronize: false });
  await source.prepare();
  const runner = source.createQueryRunner();
  const calls: { sql: string; parameters: unknown[] }[] = [];
  runner.query = async (sql: string, parameters?: unknown[]) => {
    calls.push({ sql, parameters: parameters ?? [] });
    const result = new QueryResult();
    result.affected = affected;
    result.records = sql.startsWith('SELECT') || affected === 0 ? [] : [{ id: runId, userId, status: 'QUEUED', revision: 1 }];
    result.raw = result.records;
    return result;
  };
  const store = new AgentRunStore(runner.manager.getRepository(AgentRun));
  return { store, calls };
}

test('创建只写允许字段，强制服务端 ID 和初始状态', async () => {
  const { store, calls } = await setup();
  await store.create(userId, { mode: 'task', goal: '整理周报', workflowVersion: 'v1',
    ...{ id: runId, status: 'COMPLETED', revision: 10, userId: runId },
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]);
  assert.match(calls[0].sql, /^INSERT INTO "agent_runs"/);
  assert.ok(calls[0].parameters.includes(userId));
  assert.ok(calls[0].parameters.includes('CREATED'));
  assert.ok(calls[0].parameters.includes(0));
  assert.ok(!calls[0].parameters.includes(runId));
  assert.ok(!calls[0].parameters.includes('COMPLETED'));
  assert.ok(!calls[0].sql.includes('threadId'));
  assert.ok(!calls[0].sql.includes('triggerMessageId'));
});

test('会话 Run 显式写入 threadId 与 triggerMessageId，独立 Run 保持旧列兼容', async () => {
  const { store, calls } = await setup();
  const triggerMessageId = '44444444-4444-4444-8444-444444444444';
  await store.create(userId, { mode: 'dialogue', goal: '继续讨论', workflowVersion: 'v1', threadId: runId, triggerMessageId });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]);
  assert.ok(calls[0].sql.includes('threadId'));
  assert.ok(calls[0].sql.includes('triggerMessageId'));
  assert.ok(calls[0].parameters.includes(runId));
  assert.ok(calls[0].parameters.includes(triggerMessageId));
});

test('读取同时约束用户和 Run，未匹配返回 null', async () => {
  const { store, calls } = await setup();
  assert.equal(await store.get(userId, runId), null);
  assert.ok(calls[0]);
  assert.match(calls[0].sql, /"AgentRun"\."id" = \$1/);
  assert.match(calls[0].sql, /"AgentRun"\."userId" = \$2/);
  assert.deepEqual(calls[0].parameters, [runId, userId]);
});

test('状态更新只发一条 SQL，原子比较归属、旧状态和修订号', async () => {
  const { store, calls } = await setup();
  const result = await store.transition(userId, runId, { status: 'CREATED', revision: 0 }, { type: 'ENQUEUE' });
  assert.equal(result.revision, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]);
  assert.match(calls[0].sql, /"revision" = "revision" \+ 1/);
  assert.match(calls[0].sql, /clock_timestamp\(\)/);
  assert.match(calls[0].sql, /WHERE "id" = \$2 AND "userId" = \$3 AND "status" = \$4 AND "revision" = \$5/);
  assert.deepEqual(calls[0].parameters, ['QUEUED', runId, userId, 'CREATED', 0]);
});

test('未匹配更新返回统一冲突，不追加查询或重试', async () => {
  const { store, calls } = await setup(0);
  await assert.rejects(store.transition(userId, runId, { status: 'CREATED', revision: 0 }, { type: 'ENQUEUE' }),
    { code: 'AGENT_RUN_UPDATE_CONFLICT' });
  assert.equal(calls.length, 1);
});

test('非法 ID、创建参数、修订号和终态转换在访问数据库前拒绝', async () => {
  const { store, calls } = await setup();
  await assert.rejects(store.get('', runId), AgentRunStoreError);
  await assert.rejects(store.create(userId, { mode: 'task', goal: ' ', workflowVersion: 'v1' }), AgentRunStoreError);
  await assert.rejects(store.create(userId, { mode: 'task', goal: 'x', workflowVersion: 'a'.repeat(129) }), AgentRunStoreError);
  for (const revision of [-1, 0.5, NaN, 2147483647]) {
    await assert.rejects(store.transition(userId, runId, { status: 'CREATED', revision }, { type: 'ENQUEUE' }), AgentRunStoreError);
  }
  await assert.rejects(store.transition(userId, runId, { status: 'COMPLETED', revision: 1 }, { type: 'ENQUEUE' }), AgentRunTransitionError);
  assert.equal(calls.length, 0);
});
