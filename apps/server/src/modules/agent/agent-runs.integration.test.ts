/**
 * 真实 PostgreSQL 迁移约束验证。仅显式启用时连接既有专用测试库，
 * 在随机隔离 schema 中创建最小 users 夹具，不导入会读取 .env 的生产数据源。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DataSource } from 'typeorm';

import { AgentRunStore } from './agent-run.store';
import { AgentRunWriter } from './agent-run.writer';
import { AgentRun } from './entity/agent-run.entity';
import { CreateAgentRuns1789344000000 } from '../../migrations/1789344000000-CreateAgentRuns';
import { CreateAgentEvents1789344001000 } from '../../migrations/1789344001000-CreateAgentEvents';
import { AddAgentEventSequence1789430400000 } from '../../migrations/1789430400000-AddAgentEventSequence';
import { CreateAgentToolCalls1789430401000 } from '../../migrations/1789430401000-CreateAgentToolCalls';

test('Agent Run 迁移支持归属约束、状态约束、修订竞争及级联清理', {
  skip: process.env.RUN_INTEGRATION_TESTS !== '1',
}, async () => {
  const source = new DataSource({
    type: 'postgres', host: '127.0.0.1', port: 5433,
    username: 'inkweaver_test', password: 'inkweaver_test', database: 'syncbox_test',
    synchronize: false, entities: [AgentRun],
  });
  const schema = `agent_run_test_${randomUUID().replaceAll('-', '')}`;
  await source.initialize();
  const runner = source.createQueryRunner();
  await runner.connect();
  try {
    // 测试 DDL 与数据放在同一事务，结束后回滚，不改动其他测试或业务表。
    await runner.startTransaction();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query('CREATE TABLE users (id uuid PRIMARY KEY)');
    const migration = new CreateAgentRuns1789344000000();
    await migration.up(runner);
    const eventMigration = new CreateAgentEvents1789344001000();
    await eventMigration.up(runner);
    const sequenceMigration = new AddAgentEventSequence1789430400000();
    await sequenceMigration.up(runner);
    // 当前实体包含后续版本字段；本测试只验证 Run 基础约束，补齐列而不引入成果/Checkpoint 依赖表。
    await runner.query(`ALTER TABLE agent_runs
      ADD COLUMN "threadId" uuid, ADD COLUMN "triggerMessageId" uuid,
      ADD COLUMN "revisionArtifactId" uuid, ADD COLUMN "revisionBaseVersion" integer,
      ADD COLUMN "revisionRange" jsonb,
      ADD COLUMN "checkpointKey" text GENERATED ALWAYS AS ("userId"::text || ':' || id::text) STORED,
      ADD CONSTRAINT "UQ_agent_runs_checkpoint_key" UNIQUE ("checkpointKey"),
      ADD COLUMN "executionPaused" boolean NOT NULL DEFAULT true,
      ADD COLUMN "cancelRequested" boolean NOT NULL DEFAULT false,
      ADD COLUMN "lastErrorCode" varchar(64),
      ADD COLUMN "nextDispatchAt" timestamptz NOT NULL DEFAULT clock_timestamp()`);
    const callMigration = new CreateAgentToolCalls1789430401000();
    await callMigration.up(runner);
    const userId = randomUUID();
    const runId = randomUUID();
    await runner.query('INSERT INTO users(id) VALUES ($1)', [userId]);
    const insert = `INSERT INTO agent_runs(id, "userId", mode, goal, "workflowVersion") VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const [row] = await runner.query(insert, [runId, userId, 'dialogue', '总结资料', 'v1']);
    assert.equal(row.status, 'CREATED');
    assert.equal(row.revision, 0);
    assert.ok(row.createdAt instanceof Date);

    /** 每个预期失败使用保存点，避免 PostgreSQL 的失败事务影响后续断言。 */
    async function rejects(sql: string, params: unknown[], code: string): Promise<void> {
      await runner.query('SAVEPOINT invalid_input');
      await assert.rejects(() => runner.query(sql, params), (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === code);
      await runner.query('ROLLBACK TO SAVEPOINT invalid_input');
      await runner.query('RELEASE SAVEPOINT invalid_input');
    }

    await rejects(insert, [randomUUID(), randomUUID(), 'task', 'x', 'v1'], '23503');
    await rejects(insert, [runId, userId, 'task', 'x', 'v1'], '23505');
    await rejects(insert, [randomUUID(), userId, 'unknown', 'x', 'v1'], '23514');
    await rejects(insert, [randomUUID(), userId, 'task', ' ', 'v1'], '23514');
    await rejects(insert, [randomUUID(), userId, 'task', 'x', ' '], '23514');
    await rejects('UPDATE agent_runs SET status = $1 WHERE id = $2', ['INVALID', runId], '23514');
    await rejects('UPDATE agent_runs SET revision = -1 WHERE id = $1', [runId], '23514');

    const cas = `UPDATE agent_runs SET status = 'QUEUED', revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1 AND "userId" = $2 AND revision = 0 RETURNING revision`;
    assert.equal((await runner.query(cas, [runId, randomUUID()]))[1], 0);
    const first = await runner.query(cas, [runId, userId]);
    const stale = await runner.query(cas, [runId, userId]);
    assert.equal(first[1], 1);
    assert.equal(stale[1], 0);
    // 通过实际持久化入口验证映射与条件更新；同事务内的顺序冲突不替代多连接竞争测试。
    const store = new AgentRunStore(runner.manager.getRepository(AgentRun));
    const created = await store.create(userId, { mode: 'task', goal: '生成周报', workflowVersion: 'v1' });
    assert.equal(created.status, 'CREATED');
    assert.equal(created.revision, 0);
    assert.ok(created.createdAt instanceof Date);
    assert.equal(await store.get(randomUUID(), created.id), null);
    assert.equal((await store.get(userId, created.id))?.goal, '生成周报');
    const queued = await store.transition(userId, created.id, { status: 'CREATED', revision: 0 }, { type: 'ENQUEUE' });
    assert.equal(queued.status, 'QUEUED');
    assert.equal(queued.revision, 1);
    assert.ok(queued.updatedAt >= created.updatedAt);
    for (const [owner, expected] of [
      [randomUUID(), { status: 'QUEUED', revision: 1 }],
      [userId, { status: 'CREATED', revision: 0 }],
      [userId, { status: 'CREATED', revision: 1 }],
    ] as const) {
      await assert.rejects(store.transition(owner, created.id, expected,
        { type: expected.status === 'QUEUED' ? 'START' : 'ENQUEUE' }), { code: 'AGENT_RUN_UPDATE_CONFLICT' });
    }
    assert.equal((await store.get(userId, created.id))?.revision, 1);
    const insertCall = `INSERT INTO agent_tool_calls
      (id, "runId", "userId", "callKey", "toolName", "toolVersion", "originKind", "connectionId", input, "requiresConfirmation")
      VALUES ($1, $2, $3, $4, 'read_document', 'v1', $5, $6, $7::jsonb, false) RETURNING *`;
    const [call] = await runner.query(insertCall, [randomUUID(), runId, userId, 'step-1', 'builtin', null, '{}']);
    assert.equal(call.status, 'PREPARED');
    assert.equal(call.sideEffect, 'none');
    assert.equal(call.attemptCount, 0);
    assert.equal(call.revision, 0);
    assert.equal(call.cancelRequested, false);
    await rejects(insertCall, [randomUUID(), runId, randomUUID(), 'step-2', 'builtin', null, '{}'], '23503');
    await rejects(insertCall, [randomUUID(), runId, userId, 'step-1', 'builtin', null, '{}'], '23505');
    // 相同逻辑键可以属于不同 Run；MCP 必须固定连接身份。
    await runner.query(insertCall, [randomUUID(), created.id, userId, 'step-1', 'mcp', 'connection-1', '{}']);
    for (const [origin, connection, input] of [['builtin', 'unexpected', '{}'], ['mcp', null, '{}'], ['mcp', ' ', '{}'], ['other', null, '{}'], ['builtin', null, '[]']] as const) {
      await rejects(insertCall, [randomUUID(), runId, userId, 'invalid', origin, connection, input], '23514');
    }
    await rejects('UPDATE agent_tool_calls SET status = $1 WHERE id = $2', ['INVALID', call.id], '23514');
    await rejects('UPDATE agent_tool_calls SET "attemptCount" = -1 WHERE id = $1', [call.id], '23514');
    await rejects('UPDATE agent_tool_calls SET revision = -1 WHERE id = $1', [call.id], '23514');
    const insertEvent = `INSERT INTO agent_events(id, "runId", "userId", sequence, type, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`;
    const eventId = randomUUID();
    const [event] = await runner.query(insertEvent, [eventId, runId, userId, 1, 'RUN_CREATED', '{}']);
    assert.equal(event.schemaVersion, 1);
    assert.ok(event.createdAt instanceof Date);
    await rejects(insertEvent, [randomUUID(), runId, randomUUID(), 2, 'RUN_STARTED', '{}'], '23503');
    await rejects(insertEvent, [randomUUID(), randomUUID(), userId, 2, 'RUN_STARTED', '{}'], '23503');
    await rejects(insertEvent, [randomUUID(), runId, userId, 1, 'RUN_STARTED', '{}'], '23505');
    await rejects(insertEvent, [eventId, runId, userId, 2, 'RUN_STARTED', '{}'], '23505');
    await rejects(insertEvent, [randomUUID(), runId, userId, 0, 'RUN_STARTED', '{}'], '23514');
    await rejects(insertEvent, [randomUUID(), runId, userId, 2, ' ', '{}'], '23514');
    for (const payload of ['[]', 'null', '"text"', '1']) {
      await rejects(insertEvent, [randomUUID(), runId, userId, 2, 'RUN_STARTED', payload], '23514');
    }
    await rejects('UPDATE agent_events SET "schemaVersion" = 2 WHERE id = $1', [eventId], '23514');
    // 事件序号独立于 Run revision；此处仅验证排序键，不代表服务已具备原子序号分配。
    await runner.query(insertEvent, [randomUUID(), runId, userId, 3, 'SOURCE_SELECTED', '{}']);
    await runner.query(insertEvent, [randomUUID(), runId, userId, 2, 'RUN_STARTED', '{}']);
    const replay = await runner.query('SELECT sequence FROM agent_events WHERE "runId" = $1 AND "userId" = $2 AND sequence > $3 ORDER BY sequence', [runId, userId, 1]);
    assert.deepEqual(replay.map((item: { sequence: number }) => item.sequence), [2, 3]);
    const writer = new AgentRunWriter(runner.manager);
    const written = await writer.create(userId, { mode: 'task', goal: '事务测试', workflowVersion: 'v1' });
    await writer.transition(userId, written.id, { status: 'CREATED', revision: 0 }, { type: 'ENQUEUE' });
    const history = await runner.query('SELECT sequence, type, payload FROM agent_events WHERE "runId" = $1 ORDER BY sequence', [written.id]);
    assert.deepEqual(history.map((item: { sequence: number }) => item.sequence), [1, 2]);
    assert.equal(history[1].payload.to, 'QUEUED');
    await assert.rejects(writer.transition(userId, written.id, { status: 'CREATED', revision: 0 }, { type: 'ENQUEUE' }), { code: 'AGENT_RUN_UPDATE_CONFLICT' });
    // 注入事件写入失败：状态变化和序号分配都必须回滚。
    await runner.query(`ALTER TABLE agent_events ADD CONSTRAINT test_fail_event CHECK (type <> 'RUN_STATUS_CHANGED') NOT VALID`);
    await assert.rejects(writer.transition(userId, written.id, { status: 'QUEUED', revision: 1 }, { type: 'START' }));
    assert.equal((await store.get(userId, written.id))?.status, 'QUEUED');
    assert.equal((await store.get(userId, written.id))?.revision, 1);
    await runner.query('ALTER TABLE agent_events DROP CONSTRAINT test_fail_event');
    // 清理历史事件不重用旧序号。
    await runner.query('DELETE FROM agent_events WHERE "runId" = $1', [written.id]);
    await writer.transition(userId, written.id, { status: 'QUEUED', revision: 1 }, { type: 'START' });
    assert.equal((await runner.query('SELECT sequence FROM agent_events WHERE "runId" = $1', [written.id]))[0].sequence, 3);
    // 验证未来调用表可用组合外键同时约束 Run 与用户，防止跨用户挂载。
    await runner.query(`CREATE TABLE call_fixture (
      "runId" uuid, "userId" uuid,
      FOREIGN KEY ("runId", "userId") REFERENCES agent_runs(id, "userId") ON DELETE CASCADE
    )`);
    await rejects('INSERT INTO call_fixture VALUES ($1, $2)', [runId, randomUUID()], '23503');
    await runner.query('INSERT INTO call_fixture VALUES ($1, $2)', [runId, userId]);
    await runner.query('DELETE FROM users WHERE id = $1', [userId]);
    assert.equal((await runner.query('SELECT * FROM agent_runs')).length, 0);
    assert.equal((await runner.query('SELECT * FROM call_fixture')).length, 0);
    assert.equal((await runner.query('SELECT * FROM agent_events')).length, 0);
    assert.equal((await runner.query('SELECT * FROM agent_tool_calls')).length, 0);
    await callMigration.down(runner);
    await runner.query('DROP TABLE call_fixture');
    await eventMigration.down(runner);
    await sequenceMigration.down(runner);
    assert.equal((await runner.query("SELECT to_regclass('agent_events') AS name"))[0].name, null);
    await migration.down(runner);
    assert.equal((await runner.query("SELECT to_regclass('agent_runs') AS name"))[0].name, null);
    await migration.up(runner);
    await eventMigration.up(runner);
    await callMigration.up(runner);
    assert.equal((await runner.query('SELECT * FROM agent_runs')).length, 0);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
});
