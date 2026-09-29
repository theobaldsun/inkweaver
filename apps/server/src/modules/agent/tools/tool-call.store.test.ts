import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolCallStore } from './tool-call.store';
import { AgentRun } from '../entity/agent-run.entity';
import { AgentToolAttempt } from '../entity/agent-tool-attempt.entity';

import type { ToolCallLifecycle } from './tool-call-lifecycle';
import type { CreateToolCallRecord } from './tool-call.store';
import type { EntityManager } from 'typeorm';

const userId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const request: CreateToolCallRecord = { runId, callKey: 'step-1', origin: { kind: 'builtin' }, prepared: {
  status: 'prepared', requiresConfirmation: false, call: { userId, name: 'read', version: 'v1', input: { a: 1, b: 2 } },
} };

function setup(status = 'RUNNING', existing: object | null = null) {
  let inserted: Record<string, unknown> | undefined;
  const operations: string[] = [];
  const builder = { insert() { return this; }, into() { return this; }, values(value: Record<string, unknown>) { inserted = value; return this; },
    returning() { return this; }, async execute() { operations.push('insert'); return { raw: [inserted] }; } };
  const repo = { async findOneBy(criteria: unknown) { operations.push('call'); assert.ok(criteria); return existing; },
    createQueryBuilder: () => builder, create: (value: unknown) => value };
  const tx = { queryRunner: { isTransactionActive: true }, query: async (sql: string) => { operations.push(sql.includes('WITH allocated') ? 'event' : 'lock'); return [{ id: userId, sequence: 1 }]; },
    getRepository: (entity: unknown) => entity === AgentRun ? { findOneBy: async (criteria: unknown) => {
      operations.push('run'); assert.deepEqual(criteria, { id: runId, userId }); return { id: runId, status };
    } } : repo };
  const manager = { ...tx, transaction: async (isolation: string, action: (manager: unknown) => Promise<unknown>) => {
    assert.equal(isolation, 'READ COMMITTED'); return action(tx);
  } } as unknown as EntityManager;
  return { store: new ToolCallStore(manager), operations, inserted: () => inserted };
}

test('创建保存独立输入和固定初始状态，先锁用户再访问 Run', async () => {
  const fixture = setup();
  const result = await fixture.store.create(userId, request);
  assert.deepEqual(fixture.operations, ['lock', 'run', 'call', 'insert', 'event']);
  assert.equal(result.status, 'PREPARED');
  assert.equal(result.revision, 0);
  assert.notEqual(result.input, request.prepared.call.input);
  assert.equal(fixture.inserted()?.userId, userId);
});

test('同键同内容复用，包括 JSON 对象键顺序不同；不重置已有状态', async () => {
  const existing = { toolName: 'read', toolVersion: 'v1', originKind: 'builtin', connectionId: null,
    input: { b: 2, a: 1 }, requiresConfirmation: false, status: 'SUCCEEDED' };
  const fixture = setup('COMPLETED', existing);
  assert.equal(await fixture.store.create(userId, request), existing);
  assert.equal(fixture.inserted(), undefined);
  for (const change of [{ input: { a: 3 } }, { toolVersion: 'v2' }, { connectionId: 'x' }, { requiresConfirmation: true }]) {
    await assert.rejects(setup('RUNNING', { ...existing, ...change }).store.create(userId, request), /TOOL_CALL_KEY_CONFLICT/);
  }
});

test('非运行 Run 不建新单，用户不匹配及非法键在事务前拒绝', async () => {
  await assert.rejects(setup('QUEUED').store.create(userId, request), /RUN_NOT_ACCEPTING_CALLS/);
  for (const changed of [{ ...request, callKey: '' }, { ...request, prepared: { ...request.prepared, call: { ...request.prepared.call, userId: runId } } }]) {
    const fixture = setup();
    await assert.rejects(fixture.store.create(userId, changed), /INVALID_TOOL_CALL_RECORD/);
    assert.deepEqual(fixture.operations, []);
  }
});

test('查询使用完整归属条件', async () => {
  const manager = { getRepository: () => ({ findOneBy: async (criteria: unknown) => {
    assert.deepEqual(criteria, { id: runId, runId, userId }); return null;
  } }) } as unknown as EntityManager;
  assert.equal(await new ToolCallStore(manager).get(userId, runId, runId), null);
});

/** 验证分支和更新字段；数据库锁与事务隔离另由真实集成测试验证。 */
function updateFixture(state: ToolCallLifecycle, revision = 0, runStatus = 'RUNNING', affected = 1) {
  let update: Record<string, unknown> | undefined;
  const row = { id: runId, runId, userId, ...state, revision };
  const builder = { update() { return this; }, set(value: Record<string, unknown>) { update = value; return this; },
    where(sql: string, params: unknown) {
      assert.match(sql, /"status" = :status AND "revision" = :revision/);
      assert.deepEqual(params, { callId: runId, runId, userId, status: state.status, revision });
      return this;
    }, returning() { return this; }, async execute() { return { affected, raw: [{ ...row, ...update, revision: revision + 1 }] }; } };
  const tx = { queryRunner: { isTransactionActive: true }, query: async () => [{ id: userId }],
    getRepository: (entity: unknown) => entity === AgentToolAttempt ? { insert: async () => ({}) } : entity === AgentRun ? { findOneBy: async () => ({ status: runStatus }) } : {
      findOneBy: async (criteria: unknown) => { assert.deepEqual(criteria, { id: runId, runId, userId }); return row; },
      createQueryBuilder: () => builder, create: (value: unknown) => value,
    } };
  const manager = { transaction: async (_isolation: string, action: (value: unknown) => Promise<unknown>) => action(tx) } as unknown as EntityManager;
  return { store: new ToolCallStore(manager), update: () => update };
}

const ready: ToolCallLifecycle = { status: 'READY', sideEffect: 'none', attemptCount: 0, requiresConfirmation: false, cancelRequested: false };

test('状态持久化使用数据库生命周期，开始增加次数，执行中取消保留未知结果', async () => {
  const fixture = updateFixture(ready);
  const result = await fixture.store.transition(userId, runId, runId, 0, { type: 'START' });
  assert.equal(result.status, 'EXECUTING');
  assert.equal(result.attemptCount, 1);
  assert.equal(result.sideEffect, 'unknown');
  assert.equal(result.revision, 1);
  assert.ok(!Object.hasOwn(fixture.update()!, 'input'));
  const executing = updateFixture({ ...ready, status: 'EXECUTING', sideEffect: 'unknown', attemptCount: 1 });
  const cancelled = await executing.store.transition(userId, runId, runId, 0, { type: 'CANCEL_REQUESTED' });
  assert.equal(cancelled.status, 'EXECUTING');
  assert.equal(cancelled.cancelRequested, true);
  assert.equal(cancelled.sideEffect, 'unknown');
});

test('过期版本、终态、非运行 Run 启动、条件更新失败均拒绝', async () => {
  await assert.rejects(updateFixture(ready, 1).store.transition(userId, runId, runId, 0, { type: 'START' }), /TOOL_CALL_UPDATE_CONFLICT/);
  await assert.rejects(updateFixture({ ...ready, status: 'SUCCEEDED' }).store.transition(userId, runId, runId, 0, { type: 'START' }), /INVALID_TOOL_CALL_TRANSITION/);
  await assert.rejects(updateFixture(ready, 0, 'WAITING_CONFIRMATION').store.transition(userId, runId, runId, 0, { type: 'START' }), /RUN_NOT_ACCEPTING_CALLS/);
  await assert.rejects(updateFixture(ready, 0, 'RUNNING', 0).store.transition(userId, runId, runId, 0, { type: 'START' }), /TOOL_CALL_UPDATE_CONFLICT/);
  await assert.rejects(updateFixture({ ...ready, attemptCount: 2147483647 }).store.transition(userId, runId, runId, 0, { type: 'START' }), /INVALID_TOOL_CALL_RECORD/);
});
