/** 专用测试库、随机独立 schema；提交夹具后使用多连接验证真实事务竞争。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DataSource } from 'typeorm';

import { registerReadDocumentTool } from './read-document.tool';
import { ToolAuthorization } from './tool-authorization';
import { ToolCallStore } from './tool-call.store';
import { ToolCatalog } from './tool-catalog';
import { ToolExecutionControl } from './tool-execution-control';
import { ToolExecutionMaintenance } from './tool-execution-maintenance';
import { ToolExecutionRegistry } from './tool-execution-registry';
import { ToolExecutor } from './tool-executor';
import { CreateAgentRuns1789344000000 } from '../../../migrations/1789344000000-CreateAgentRuns';
import { CreateAgentEvents1789344001000 } from '../../../migrations/1789344001000-CreateAgentEvents';
import { AddAgentEventSequence1789430400000 } from '../../../migrations/1789430400000-AddAgentEventSequence';
import { CreateAgentToolCalls1789430401000 } from '../../../migrations/1789430401000-CreateAgentToolCalls';
import { CreateAgentToolAttempts1789516800000 } from '../../../migrations/1789516800000-CreateAgentToolAttempts';
import { CreateAgentConfirmations1789603200000 } from '../../../migrations/1789603200000-CreateAgentConfirmations';
import { AddAgentReadExecution1789689600000 } from '../../../migrations/1789689600000-AddAgentReadExecution';
import { AddAgentExecutionRecovery1789776000000 } from '../../../migrations/1789776000000-AddAgentExecutionRecovery';
import { AddAgentRetryScheduling1789862400000 } from '../../../migrations/1789862400000-AddAgentRetryScheduling';
import { deleteAgentData } from '../agent-data.cleanup';
import { exportAgentData } from '../agent-data.exporter';
import { AgentEventReader } from '../agent-event.reader';
import { AgentRunWriter } from '../agent-run.writer';
import { AgentRun } from '../entity/agent-run.entity';
import { AgentToolAttempt } from '../entity/agent-tool-attempt.entity';
import { AgentToolCall } from '../entity/agent-tool-call.entity';

import type { CreateToolCallRecord } from './tool-call.store';

test('工具调用持久化生命周期：多连接竞争、事件原子性及数据清理', {
  skip: process.env.RUN_INTEGRATION_TESTS !== '1', timeout: 60000,
}, async (t) => {
  const schema = `agent_call_test_${randomUUID().replaceAll('-', '')}`;
  const connection = { type: 'postgres' as const, host: '127.0.0.1', port: 5433,
    username: 'inkweaver_test', password: 'inkweaver_test', database: 'syncbox_test',
    synchronize: false, connectTimeoutMS: 5000 };
  const admin = await new DataSource(connection).initialize();
  const source = new DataSource({ ...connection, schema, entities: [AgentRun, AgentToolCall, AgentToolAttempt],
    extra: { options: `-c search_path=${schema} -c statement_timeout=15000`, max: 6 } });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await source.initialize();
    const runner = source.createQueryRunner();
    try {
      await runner.query('CREATE TABLE users (id uuid PRIMARY KEY)');
      await new CreateAgentRuns1789344000000().up(runner);
      await new CreateAgentEvents1789344001000().up(runner);
      await new AddAgentEventSequence1789430400000().up(runner);
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
      await new CreateAgentToolCalls1789430401000().up(runner);
      await new CreateAgentToolAttempts1789516800000().up(runner);
      await new CreateAgentConfirmations1789603200000().up(runner);
      await new AddAgentReadExecution1789689600000().up(runner);
      await new AddAgentExecutionRecovery1789776000000().up(runner);
      await new AddAgentRetryScheduling1789862400000().up(runner);
      await runner.query('CREATE TABLE documents (id uuid PRIMARY KEY, "userId" uuid, title text, content text, "folderId" uuid, "deletedAt" timestamptz)');
    } finally { await runner.release(); }
    const userId = randomUUID();
    const otherUser = randomUUID();
    await source.query('INSERT INTO users VALUES ($1), ($2)', [userId, otherUser]);
    const writer = new AgentRunWriter(source.manager);
    let run = await writer.create(userId, { mode: 'task', goal: '调用事务测试', workflowVersion: 'v1' });
    run = await writer.transition(userId, run.id, run, { type: 'ENQUEUE' });
    run = await writer.transition(userId, run.id, run, { type: 'START' });
    const store = new ToolCallStore(source.manager);
    const request: CreateToolCallRecord = { runId: run.id, callKey: 'step-1', origin: { kind: 'builtin' }, prepared: {
      status: 'prepared', requiresConfirmation: false, call: { userId, name: 'read', version: 'v1', input: { a: 1, b: 2 } },
    } };
    let call: AgentToolCall;
    const history = async () => (await new AgentEventReader(source.manager).list(userId, run.id, 0, 100)).events;
    const sequence = async () => (await source.query('SELECT "lastEventSequence" AS seq FROM agent_runs WHERE id = $1', [run.id]))[0].seq;

    await t.test('并发同键创建只产生一条调用和一个事件；归属查询与内容冲突', async () => {
      const [first, second] = await Promise.all([store.create(userId, request), store.create(userId, request)]);
      call = first;
      assert.equal(first.id, second.id);
      assert.equal((await history()).length, 4);
      assert.equal((await history())[3]!.body.type, 'TOOL_CALL_CREATED');
      assert.equal(await store.get(otherUser, run.id, call.id), null);
      assert.equal(await store.get(userId, randomUUID(), call.id), null);
      const reordered = structuredClone(request);
      reordered.prepared.call.input = { b: 2, a: 1 };
      assert.equal((await store.create(userId, reordered)).id, call.id);
      const changed = structuredClone(request);
      changed.prepared.call.input = { a: 9 };
      await assert.rejects(store.create(userId, changed), { code: 'TOOL_CALL_KEY_CONFLICT' });
      assert.equal((await history()).length, 4);
      assert.equal((await store.get(userId, run.id, call.id))?.revision, 0);
    });

    await t.test('事件插入失败回滚新调用、状态与序号；恢复后序号连续', async () => {
      const before = await sequence();
      await source.query(`ALTER TABLE agent_events ADD CONSTRAINT fail_tool_event CHECK (type NOT LIKE 'TOOL_CALL_%') NOT VALID`);
      try {
        await assert.rejects(store.create(userId, { ...request, callKey: 'rollback' }));
        await assert.rejects(store.transition(userId, run.id, call.id, 0, { type: 'RESOURCES_APPROVED' }));
        assert.equal((await source.query('SELECT id FROM agent_tool_calls WHERE "callKey" = $1', ['rollback'])).length, 0);
        assert.equal((await store.get(userId, run.id, call.id))?.status, 'PREPARED');
        assert.equal((await store.get(userId, run.id, call.id))?.revision, 0);
        assert.equal(await sequence(), before);
      } finally { await source.query('ALTER TABLE agent_events DROP CONSTRAINT fail_tool_event'); }
      call = await store.transition(userId, run.id, call.id, 0, { type: 'RESOURCES_APPROVED' });
      assert.equal(call.status, 'READY');
      assert.equal(await sequence(), before + 1);
    });

    await t.test('尝试插入失败时 START、尝试计数与事件全部回滚', async () => {
      const before = await sequence();
      await source.query(`ALTER TABLE agent_tool_attempts ADD CONSTRAINT fail_attempt CHECK (status <> 'STARTED') NOT VALID`);
      try {
        await assert.rejects(store.transition(userId, run.id, call.id, call.revision, { type: 'START' }));
        assert.equal((await store.get(userId, run.id, call.id))?.status, 'READY');
        assert.equal((await store.get(userId, run.id, call.id))?.attemptCount, 0);
        assert.equal(await sequence(), before);
        assert.equal(await store.getAttempt(userId, run.id, call.id, 1), null);
      } finally { await source.query('ALTER TABLE agent_tool_attempts DROP CONSTRAINT fail_attempt'); }
    });

    await t.test('两个独立连接竞争同一修订号仅一个启动成功', async () => {
      const a = source.createQueryRunner();
      const b = source.createQueryRunner();
      try {
        await Promise.all([a.connect(), b.connect()]);
        const [pidA, pidB] = await Promise.all([a.query('SELECT pg_backend_pid() AS pid'), b.query('SELECT pg_backend_pid() AS pid')]);
        assert.notEqual(pidA[0].pid, pidB[0].pid);
        const outcomes = await Promise.allSettled([a, b].map((r) =>
          new ToolCallStore(r.manager).transition(userId, run.id, call.id, call.revision, { type: 'START' })));
        assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
        const failure = outcomes.find((result) => result.status === 'rejected');
        assert.equal(failure?.status === 'rejected' && failure.reason.code, 'TOOL_CALL_UPDATE_CONFLICT');
        call = (await store.get(userId, run.id, call.id))!;
        assert.equal(call.attemptCount, 1);
        assert.equal(call.revision, 2);
        assert.equal((await history()).length, 6);
      } finally { await Promise.all([a.release(), b.release()]); }
    });

    await t.test('结果必须绑定本次尝试；事件失败回滚尝试结果，数据库约束拒绝非法尝试', async () => {
      const attempt = (await store.getAttempt(userId, run.id, call.id, 1))!;
      assert.equal(attempt.status, 'STARTED');
      assert.equal(attempt.startRevision, call.revision);
      assert.ok(attempt.startedAt instanceof Date);
      assert.equal(attempt.endedAt, null);
      assert.equal(await store.getAttempt(otherUser, run.id, call.id, 1), null);
      await assert.rejects(store.transition(userId, run.id, call.id, call.revision, { type: 'SUCCEEDED', sideEffect: 'none' }), /TOOL_ATTEMPT_ID_REQUIRED/);
      await assert.rejects(store.transition(userId, run.id, call.id, call.revision, { type: 'SUCCEEDED', sideEffect: 'none' }, randomUUID()), /TOOL_ATTEMPT_UPDATE_CONFLICT/);
      const before = await sequence();
      await source.query(`ALTER TABLE agent_events ADD CONSTRAINT fail_attempt_event CHECK (type <> 'TOOL_CALL_STATE_CHANGED') NOT VALID`);
      try {
        await assert.rejects(store.transition(userId, run.id, call.id, call.revision, { type: 'SUCCEEDED', sideEffect: 'none' }, attempt.id));
        assert.equal((await store.getAttempt(userId, run.id, call.id, 1))?.status, 'STARTED');
        assert.equal((await store.get(userId, run.id, call.id))?.revision, call.revision);
        assert.equal(await sequence(), before);
      } finally { await source.query('ALTER TABLE agent_events DROP CONSTRAINT fail_attempt_event'); }
      const finished = { ...attempt, id: randomUUID(), attemptNumber: 2, status: 'FAILED' as const, endedAt: new Date() };
      for (const [change, code] of [
        [{ attemptNumber: 0 }, '23514'], [{ userId: otherUser }, '23503'],
        [{ status: 'STARTED' as const }, '23514'], [{ attemptNumber: 1 }, '23505'],
      ] as const) {
        await assert.rejects(source.getRepository(AgentToolAttempt).insert({ ...finished, ...change }), { code });
      }
      await assert.rejects(source.getRepository(AgentToolAttempt).insert({ ...attempt, id: randomUUID(), attemptNumber: 2 }), { code: '23505' });
    });

    await t.test('取消意图也记录事件；未知结果对账后终态不可重启', async () => {
      call = await store.transition(userId, run.id, call.id, call.revision, { type: 'CANCEL_REQUESTED' });
      assert.equal(call.status, 'EXECUTING');
      assert.equal(call.cancelRequested, true);
      const event = (await history()).at(-1)!.body;
      assert.equal(event.type, 'TOOL_CALL_STATE_CHANGED');
      if (event.type === 'TOOL_CALL_STATE_CHANGED') {
        assert.equal(event.payload.from.cancelRequested, false);
        assert.equal(event.payload.to.cancelRequested, true);
      }
      call = await store.transition(userId, run.id, call.id, call.revision, { type: 'STOPPED_WITHOUT_EFFECT' }, (await store.getAttempt(userId, run.id, call.id, call.attemptCount))!.id);
      assert.equal(call.status, 'CANCELLED');
      assert.equal(call.sideEffect, 'none');
      await assert.rejects(store.transition(userId, run.id, call.id, call.revision, { type: 'START' }), { code: 'INVALID_TOOL_CALL_TRANSITION' });
      assert.equal((await store.create(userId, request)).status, 'CANCELLED');
    });

    await t.test('确认、重试、成功完成贯通；Run 事件与调用事件共享序号', async () => {
      let second = await store.create(userId, { ...request, callKey: 'step-2', prepared: { ...request.prepared, requiresConfirmation: true } });
      for (const event of [
        { type: 'RESOURCES_APPROVED' }, { type: 'CONFIRMED' }, { type: 'START' },
        { type: 'OUTCOME_UNKNOWN' }, { type: 'RETRY_SCHEDULED', sideEffect: 'unknown', guarantee: 'idempotency-key' },
        { type: 'RETRY_DUE' }, { type: 'START' }, { type: 'SUCCEEDED', sideEffect: 'committed' },
      ] as const) {
        if (event.type === 'SUCCEEDED') {
          const first = (await store.getAttempt(userId, run.id, second.id, 1))!;
          await assert.rejects(store.transition(userId, run.id, second.id, second.revision, event, first.id), /TOOL_ATTEMPT_UPDATE_CONFLICT/);
          assert.equal(first.status, 'OUTCOME_UNKNOWN');
        }
        second = await store.transition(userId, run.id, second.id, second.revision, event,
          second.attemptCount ? (await store.getAttempt(userId, run.id, second.id, second.attemptCount))!.id : undefined);
      }
      const firstAttempt = (await store.getAttempt(userId, run.id, second.id, 1))!;
      const secondAttempt = (await store.getAttempt(userId, run.id, second.id, 2))!;
      assert.notEqual(firstAttempt.id, secondAttempt.id);
      assert.equal(firstAttempt.status, 'OUTCOME_UNKNOWN');
      assert.equal(secondAttempt.status, 'SUCCEEDED');
      assert.ok(firstAttempt.endedAt && secondAttempt.endedAt);
      assert.equal(second.attemptCount, 2);
      assert.equal(second.status, 'SUCCEEDED');
      run = await writer.transition(userId, run.id, run, { type: 'COMPLETE' });
      const events = await history();
      assert.deepEqual(events.map((event) => event.sequence), Array.from({ length: events.length }, (_, index) => index + 1));
      assert.equal(events.at(-1)?.body.type, 'RUN_STATUS_CHANGED');
      assert.equal((await store.create(userId, request)).id, call.id);
      await assert.rejects(store.create(userId, { ...request, callKey: 'late' }), { code: 'RUN_NOT_ACCEPTING_CALLS' });
    });

    await t.test('导出包含调用与事件且隔离归属；清理事务回滚及级联删除', async () => {
      const exported = await exportAgentData(source.manager, userId);
      assert.equal(exported.toolCalls.length, 2);
      assert.equal(exported.toolAttempts.length, 3);
      assert.equal(exported.events.length, (await history()).length);
      const otherExport = await exportAgentData(source.manager, otherUser);
      for (const rows of Object.values(otherExport)) assert.deepEqual(rows, []);
      await assert.rejects(source.transaction(async (manager) => {
        await deleteAgentData(manager, userId);
        throw new Error('rollback cleanup');
      }), /rollback cleanup/);
      assert.equal((await exportAgentData(source.manager, userId)).toolCalls.length, 2);
      await source.transaction((manager) => deleteAgentData(manager, userId));
      assert.equal(await source.getRepository(AgentToolAttempt).countBy({ userId }), 0);
      const emptyExport = await exportAgentData(source.manager, userId);
      for (const rows of Object.values(emptyExport)) assert.deepEqual(rows, []);
    });

    await t.test('写入先持有用户锁时，清理等待提交后拒绝删除活跃 Run', async () => {
      const writing = source.createQueryRunner();
      const cleaning = source.createQueryRunner();
      let cleanup: Promise<void> | undefined;
      try {
        await Promise.all([writing.connect(), cleaning.connect()]);
        await writing.startTransaction();
        await new AgentRunWriter(writing.manager).create(userId, { mode: 'task', goal: '竞争保护', workflowVersion: 'v1' });
        const [{ pid }] = await cleaning.query('SELECT pg_backend_pid() AS pid');
        cleanup = cleaning.manager.transaction((manager) => deleteAgentData(manager, userId));
        // 立即安装拒绝处理，避免等待数据库锁时出现未处理 Promise rejection。
        const rejected = assert.rejects(cleanup, /存在未结束的 Agent 任务/);
        const deadline = Date.now() + 5000;
        while (!(await source.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]))[0].blocked) {
          assert.ok(Date.now() < deadline, '清理应实际阻塞在写入事务的用户锁');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await writing.commitTransaction();
        await rejected;
        assert.equal((await exportAgentData(source.manager, userId)).runs.length, 1);
      } finally {
        if (writing.isTransactionActive) await writing.rollbackTransaction();
        await cleanup?.catch(() => undefined);
        await Promise.all([writing.release(), cleaning.release()]);
      }
    });

    await t.test('清理先持锁时，等待中的新建在清理提交后创建完整新 Run', async () => {
      const records = await source.getRepository(AgentRun).findBy({ userId });
      for (const record of records) await writer.transition(userId, record.id, record, { type: 'CANCEL_SETTLED' });
      const cleaning = source.createQueryRunner();
      const writing = source.createQueryRunner();
      let pending: Promise<AgentRun> | undefined;
      try {
        await Promise.all([cleaning.connect(), writing.connect()]);
        await cleaning.startTransaction();
        await deleteAgentData(cleaning.manager, userId);
        const [{ pid }] = await writing.query('SELECT pg_backend_pid() AS pid');
        pending = new AgentRunWriter(writing.manager).create(userId, { mode: 'task', goal: '清理后的新请求', workflowVersion: 'v1' });
        void pending.catch(() => undefined);
        const deadline = Date.now() + 5000;
        while (!(await source.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]))[0].blocked) {
          assert.ok(Date.now() < deadline, '新建应实际阻塞在清理事务的用户锁');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await cleaning.commitTransaction();
        const created = await pending;
        const exported = await exportAgentData(source.manager, userId);
        assert.equal(exported.runs.length, 1);
        assert.equal(exported.events.length, 1);
        assert.equal((await new AgentEventReader(source.manager).list(userId, created.id)).events[0]?.sequence, 1);
        assert.equal(await source.getRepository(AgentRun).countBy({ id: records[0]!.id }), 0);
      } finally {
        if (cleaning.isTransactionActive) await cleaning.rollbackTransaction();
        await pending?.catch(() => undefined);
        await Promise.all([cleaning.release(), writing.release()]);
      }
    });

    await t.test('导出读取 Run 后另一连接提交状态和事件，导出仍保持原快照', async () => {
      const [record] = await source.getRepository(AgentRun).findBy({ userId });
      assert.ok(record);
      const exporting = source.createQueryRunner();
      await exporting.connect();
      const query = exporting.query.bind(exporting);
      let interleaved = false;
      // 仅给真实数据库查询加调度屏障，不模拟任何查询结果或事务行为。
      exporting.query = async (...args: Parameters<typeof exporting.query>) => {
        const result = await query(...args);
        if (args[0].includes('FROM agent_runs WHERE') && !interleaved) {
          interleaved = true;
          await writer.transition(userId, record.id, record, { type: 'ENQUEUE' });
        }
        return result;
      };
      try {
        const snapshot = await exportAgentData(exporting.manager, userId);
        assert.equal(interleaved, true);
        assert.equal((snapshot.runs[0] as AgentRun).status, 'CREATED');
        assert.equal(snapshot.events.length, 1);
        const current = await exportAgentData(source.manager, userId);
        assert.equal((current.runs[0] as AgentRun).status, 'QUEUED');
        assert.equal(current.events.length, 2);
      } finally { await exporting.release(); }
    });
    await t.test('资源授权与确认绑定：接受、拒绝、过期、变更失效及事务回滚', async () => {
      const docId = randomUUID();
      await source.query('INSERT INTO documents(id,"userId",title,content) VALUES ($1,$2,$3,$4)', [docId, userId, 'title', 'original']);
      let targetRun = await writer.create(userId, { mode: 'task', goal: '确认测试', workflowVersion: 'v1' });
      targetRun = await writer.transition(userId, targetRun.id, targetRun, { type: 'ENQUEUE' });
      targetRun = await writer.transition(userId, targetRun.id, targetRun, { type: 'START' });
      const catalog = new ToolCatalog();
      const definition = { name: 'edit', version: 'v1', description: 'edit', origin: { kind: 'builtin' as const },
        riskLevel: 'L2' as const, requiredPermissions: ['documents:write'], requiresConfirmation: true,
        inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        outputSchema: true, timeoutMs: 1000, maxOutputBytes: 1024, supportsCancellation: false, retryPolicy: 'never' as const };
      catalog.register(definition, { name: 'edit', version: 'v1', origin: { kind: 'builtin' },
        resources: () => [{ kind: 'document', id: docId, action: 'write' }], execute: async () => { throw new Error('不得执行'); } });
      const context = { policy: { principal: { userId, permissions: ['documents:write'] }, allowedTools: ['edit'], allowedRiskLevels: ['L2' as const] },
        scope: { allowOwnedLibrary: false, documentIds: [docId], folderIds: [] } };
      const auth = new ToolAuthorization(source.manager, catalog);
      const make = (key: string) => store.create(userId, { runId: targetRun.id, callKey: key, origin: { kind: 'builtin' },
        prepared: { status: 'prepared', requiresConfirmation: true, call: { userId, name: 'edit', version: 'v1', input: { id: docId } } } });
      const first = await make('approve');
      await assert.rejects(auth.authorize(userId, targetRun.id, first.id, { ...context, scope: { ...context.scope, documentIds: [] } }), /RESOURCE_NOT_ALLOWED/);
      await source.query('UPDATE documents SET "userId"=$1 WHERE id=$2', [otherUser, docId]);
      await assert.rejects(auth.authorize(userId, targetRun.id, first.id, context), /RESOURCE_NOT_ALLOWED/);
      await source.query('UPDATE documents SET "userId"=$1 WHERE id=$2', [userId, docId]);
      await source.query(`ALTER TABLE agent_events ADD CONSTRAINT fail_confirmation CHECK (type <> 'TOOL_CALL_STATE_CHANGED') NOT VALID`);
      try {
        await assert.rejects(auth.authorize(userId, targetRun.id, first.id, context));
        assert.equal((await source.query('SELECT id FROM agent_confirmations WHERE "callId"=$1', [first.id])).length, 0);
      } finally { await source.query('ALTER TABLE agent_events DROP CONSTRAINT fail_confirmation'); }
      const pending = await auth.authorize(userId, targetRun.id, first.id, context);
      assert.equal(pending.call.status, 'WAITING_CONFIRMATION');
      assert.equal((await auth.authorize(userId, targetRun.id, first.id, context)).confirmation?.id, pending.confirmation!.id);
      await assert.rejects(auth.decide(otherUser, targetRun.id, first.id, pending.confirmation!.id, true, context), /CALL_NOT_FOUND/);
      await auth.decide(userId, targetRun.id, first.id, pending.confirmation!.id, true, context);
      assert.equal((await auth.decide(userId, targetRun.id, first.id, pending.confirmation!.id, true, context)).status, 'APPROVED');
      await auth.recheck(userId, targetRun.id, first.id, context);
      await assert.rejects(auth.recheck(userId, targetRun.id, first.id, { ...context, policy: { ...context.policy, allowedTools: [] } }), /TOOL_AUTHORIZATION_DENIED/);
      await source.query('UPDATE documents SET content=$1 WHERE id=$2', ['changed', docId]);
      await assert.rejects(auth.recheck(userId, targetRun.id, first.id, context), /CONFIRMATION_BINDING_CHANGED/);
      const rejected = await make('reject');
      const rejectRecord = (await auth.authorize(userId, targetRun.id, rejected.id, context)).confirmation!;
      assert.equal((await auth.decide(userId, targetRun.id, rejected.id, rejectRecord.id, false, context)).status, 'REJECTED');
      assert.equal((await store.get(userId, targetRun.id, rejected.id))?.status, 'CANCELLED');
      const expired = await make('expire');
      await auth.authorize(userId, targetRun.id, expired.id, context);
      await source.query(`UPDATE agent_confirmations SET "createdAt"=clock_timestamp()-interval '2 minutes', "expiresAt"=clock_timestamp()-interval '1 minute' WHERE "callId"=$1`, [expired.id]);
      assert.equal((await auth.expire(userId, targetRun.id, expired.id))?.status, 'EXPIRED');
      assert.equal((await store.get(userId, targetRun.id, expired.id))?.status, 'EXPIRED');
      catalog.register({ ...definition, name: 'read_only', riskLevel: 'L0', requiresConfirmation: false, requiredPermissions: [] },
        { name: 'read_only', version: 'v1', origin: { kind: 'builtin' }, resources: () => [{ kind: 'document', id: docId, action: 'read' }],
          execute: async () => { throw new Error('不得执行'); } });
      const readContext = { ...context, policy: { ...context.policy, allowedTools: ['read_only'], allowedRiskLevels: ['L0' as const] } };
      const readCall = await store.create(userId, { runId: targetRun.id, callKey: 'read_only', origin: { kind: 'builtin' },
        prepared: { status: 'prepared', requiresConfirmation: false, call: { userId, name: 'read_only', version: 'v1', input: { id: docId } } } });
      const readAuthorization = await auth.authorize(userId, targetRun.id, readCall.id, readContext);
      assert.equal(readAuthorization.call.status, 'READY');
      assert.equal(readAuthorization.confirmation, null);
      await auth.recheck(userId, targetRun.id, readCall.id, readContext);
      assert.equal((await exportAgentData(source.manager, userId)).confirmations.length, 3);
      assert.equal((await exportAgentData(source.manager, otherUser)).confirmations.length, 0);
      await source.query('DELETE FROM agent_runs WHERE id=$1', [targetRun.id]);
      assert.equal((await source.query('SELECT id FROM agent_confirmations')).length, 0);
    });

    await t.test('真实文档执行：并发领取、预算、结果落库、输出失败与级联', async () => {
      const docId = randomUUID();
      await source.query('INSERT INTO documents(id,"userId",title,content) VALUES ($1,$2,$3,$4)', [docId, userId, '执行测试', '实际文档正文']);
      let target = await writer.create(userId, { mode: 'dialogue', goal: '读取文档', workflowVersion: 'v1' });
      target = await writer.transition(userId, target.id, target, { type: 'ENQUEUE' });
      target = await writer.transition(userId, target.id, target, { type: 'START' });
      await source.query('UPDATE agent_runs SET "toolCallLimit"=4 WHERE id=$1', [target.id]);
      const catalog = new ToolCatalog();
      registerReadDocumentTool(catalog, source.manager);
      const context = { policy: { principal: { userId, permissions: ['documents:read'] }, allowedTools: ['read_document'] },
        scope: { allowOwnedLibrary: false, documentIds: [docId], folderIds: [] } };
      const executor = new ToolExecutor(source.manager, catalog);
      const make = async (key: string, name = 'read_document') => {
        const call = await store.create(userId, { runId: target.id, callKey: key, origin: { kind: 'builtin' },
          prepared: { status: 'prepared', requiresConfirmation: false, call: { userId, name, version: '1', input: { id: docId } } } });
        await new ToolAuthorization(source.manager, catalog).authorize(userId, target.id, call.id, { ...context, policy: { ...context.policy, allowedTools: [name] } });
        return call;
      };
      const call = await make('first');
      const concurrent = await Promise.allSettled([executor.execute(userId, target.id, call.id, context), executor.execute(userId, target.id, call.id, context)]);
      assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
      const success = concurrent.find((item) => item.status === 'fulfilled');
      assert.ok(success?.status === 'fulfilled');
      assert.equal(success.value.call.status, 'SUCCEEDED');
      assert.equal((success.value.output as { content: string }).content, '实际文档正文');
      assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [success.value.attemptId]))[0].status, 'SETTLED');
      assert.equal((await source.query('SELECT output FROM agent_tool_results WHERE "attemptId"=$1', [success.value.attemptId]))[0].output.content, '实际文档正文');
      const original = catalog.resolve('read_document', '1');
      catalog.register({ ...original.definition, name: 'bad_output' }, { name: 'bad_output', version: '1', origin: { kind: 'builtin' },
        resources: original.resources, execute: async () => 42 });
      const bad = await make('bad', 'bad_output');
      const invalid = await executor.execute(userId, target.id, bad.id, { ...context, policy: { ...context.policy, allowedTools: ['bad_output'] } });
      assert.equal(invalid.errorCode, 'INVALID_TOOL_OUTPUT');
      assert.equal(invalid.call.status, 'FAILED');
      catalog.register({ ...original.definition, name: 'expired_lease' }, { name: 'expired_lease', version: '1', origin: { kind: 'builtin' },
        resources: original.resources, execute: async (input, ctx) => {
          await source.query(`UPDATE agent_tool_attempts SET "leaseExpiresAt"=clock_timestamp()-interval '1 second' WHERE id=$1`, [ctx.execution!.attemptId]);
          return original.execute(input, ctx);
        } });
      const expiredCall = await make('expired_lease', 'expired_lease');
      await assert.rejects(executor.execute(userId, target.id, expiredCall.id,
        { ...context, policy: { ...context.policy, allowedTools: ['expired_lease'] } }), /EXECUTION_CLAIM_LOST/);
      const expiredAttempt = (await store.getAttempt(userId, target.id, expiredCall.id, 1))!;
      assert.equal((await store.get(userId, target.id, expiredCall.id))?.status, 'EXECUTING');
      assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [expiredAttempt.id]))[0].status, 'RESERVED');
      assert.deepEqual(await new ToolExecutionControl(source.manager).recoverExpired(userId), [expiredAttempt.id]);
      assert.equal((await store.get(userId, target.id, expiredCall.id))?.status, 'FAILED');
      assert.equal((await source.query('SELECT "errorCode" FROM agent_tool_results WHERE "attemptId"=$1', [expiredAttempt.id]))[0].errorCode, 'READ_EXECUTION_INTERRUPTED');
      // 事件失败须回滚完成状态、结果和结算，保留已领取尝试供恢复处理。
      const rollback = await make('rollback');
      const checkpointTool = { ...original.definition, name: 'event_failure' };
      catalog.register(checkpointTool, { name: 'event_failure', version: '1', origin: { kind: 'builtin' }, resources: original.resources,
        execute: async (input, ctx) => {
          await source.query(`ALTER TABLE agent_events ADD CONSTRAINT fail_execute CHECK (type <> 'TOOL_CALL_STATE_CHANGED') NOT VALID`);
          return original.execute(input, ctx);
        } });
      const failing = await make('event_failure', 'event_failure');
      try {
        await assert.rejects(executor.execute(userId, target.id, failing.id, { ...context, policy: { ...context.policy, allowedTools: ['event_failure'] } }));
        assert.equal((await store.get(userId, target.id, failing.id))?.status, 'EXECUTING');
        const attempt = (await store.getAttempt(userId, target.id, failing.id, 1))!;
        assert.equal((await source.query('SELECT * FROM agent_tool_results WHERE "attemptId"=$1', [attempt.id])).length, 0);
        assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [attempt.id]))[0].status, 'RESERVED');
      } finally { await source.query('ALTER TABLE agent_events DROP CONSTRAINT fail_execute'); }
      await assert.rejects(executor.execute(userId, target.id, rollback.id, context), /TOOL_BUDGET_EXHAUSTED/);
      assert.equal((await store.get(userId, target.id, rollback.id))?.status, 'READY');
      const exported = await exportAgentData(source.manager, userId);
      assert.equal(exported.toolResults.length, 3);
      assert.equal(exported.budgetReservations.length, 4);
      assert.equal((await exportAgentData(source.manager, otherUser)).toolResults.length, 0);
      await source.query('DELETE FROM agent_runs WHERE id=$1', [target.id]);
      assert.equal((await source.query('SELECT * FROM agent_tool_results')).length, 0);
      assert.equal((await source.query('SELECT * FROM agent_budget_reservations')).length, 0);
    });

    await t.test('主动取消、Worker 租约续期与过期只读恢复', async () => {
      const docId = randomUUID();
      await source.query('INSERT INTO documents(id,"userId",title,content) VALUES ($1,$2,$3,$4)', [docId, userId, '恢复测试', '恢复链路正文']);
      let target = await writer.create(userId, { mode: 'task', goal: '取消恢复', workflowVersion: 'v1' });
      target = await writer.transition(userId, target.id, target, { type: 'ENQUEUE' });
      target = await writer.transition(userId, target.id, target, { type: 'START' });
      const catalog = new ToolCatalog();
      registerReadDocumentTool(catalog, source.manager);
      const original = catalog.resolve('read_document', '1');
      const context = { policy: { principal: { userId, permissions: ['documents:read'] }, allowedTools: ['read_document'] },
        scope: { allowOwnedLibrary: false, documentIds: [docId], folderIds: [] } };
      const make = async (key: string, name: string) => {
        const record = await store.create(userId, { runId: target.id, callKey: key, origin: { kind: 'builtin' },
          prepared: { status: 'prepared', requiresConfirmation: false, call: { userId, name, version: '1', input: { id: docId } } } });
        await new ToolAuthorization(source.manager, catalog).authorize(userId, target.id, record.id,
          { ...context, policy: { ...context.policy, allowedTools: [name] } });
        return (await store.get(userId, target.id, record.id))!;
      };
      const waitForAttempt = async (callId: string) => {
        const deadline = Date.now() + 5000;
        for (;;) {
          const rows = await source.query(`SELECT id,"leaseOwner","leaseExpiresAt","invocationStartedAt" FROM agent_tool_attempts
            WHERE "callId"=$1 ORDER BY "attemptNumber" DESC LIMIT 1`, [callId]);
          if (rows[0]?.invocationStartedAt) return rows[0];
          assert.ok(Date.now() < deadline, '执行尝试应进入真实调用边界');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      const registry = new ToolExecutionRegistry();
      const workerId = randomUUID();
      const executor = new ToolExecutor(source.manager, catalog,
        { workerId, leaseDurationMs: 500, heartbeatIntervalMs: 50, registry });
      const control = new ToolExecutionControl(source.manager, { workerId: randomUUID(), registry });

      catalog.register({ ...original.definition, name: 'heartbeat_read', timeoutMs: 1000, supportsCancellation: true },
        { name: 'heartbeat_read', version: '1', origin: { kind: 'builtin' }, resources: original.resources,
          execute: async (input, ctx) => {
            // 明显长于初始租约，成功只能来自心跳续期；同时保留足够收尾余量避免时钟抖动。
            await new Promise((resolve) => setTimeout(resolve, 700));
            return original.execute(input, ctx);
          } });
      const heartbeatCall = await make('heartbeat', 'heartbeat_read');
      const heartbeatResult = await executor.execute(userId, target.id, heartbeatCall.id,
        { ...context, policy: { ...context.policy, allowedTools: ['heartbeat_read'] } });
      assert.equal(heartbeatResult.call.status, 'SUCCEEDED');
      const [heartbeatAttempt] = await source.query('SELECT "leaseOwner" FROM agent_tool_attempts WHERE id=$1', [heartbeatResult.attemptId]);
      assert.equal(heartbeatAttempt.leaseOwner, null);

      catalog.register({ ...original.definition, name: 'cancel_read', timeoutMs: 1000, supportsCancellation: true },
        { name: 'cancel_read', version: '1', origin: { kind: 'builtin' }, resources: original.resources,
          execute: async (_input, ctx) => new Promise((_resolve, reject) => {
            const cancelled = () => reject(new Error('cancelled'));
            if (ctx.signal.aborted) cancelled();
            else ctx.signal.addEventListener('abort', cancelled, { once: true });
          }) });
      const cancelCall = await make('cancel', 'cancel_read');
      const cancelling = executor.execute(userId, target.id, cancelCall.id,
        { ...context, policy: { ...context.policy, allowedTools: ['cancel_read'] } });
      await waitForAttempt(cancelCall.id);
      assert.equal((await control.cancel(userId, target.id, cancelCall.id)).cancelRequested, true);
      const cancelled = await cancelling;
      assert.equal(cancelled.call.status, 'CANCELLED');
      assert.equal(cancelled.errorCode, 'TOOL_CANCELLED');
      assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [cancelled.attemptId]))[0].status, 'SETTLED');

      catalog.register({ ...original.definition, name: 'lease_lost', timeoutMs: 1000, supportsCancellation: true },
        { name: 'lease_lost', version: '1', origin: { kind: 'builtin' }, resources: original.resources,
          execute: async (_input, ctx) => new Promise((_resolve, reject) => {
            const stopped = () => reject(new Error('lease lost'));
            if (ctx.signal.aborted) stopped();
            else ctx.signal.addEventListener('abort', stopped, { once: true });
          }) });
      const lostCall = await make('lease-lost', 'lease_lost');
      const losing = executor.execute(userId, target.id, lostCall.id,
        { ...context, policy: { ...context.policy, allowedTools: ['lease_lost'] } });
      const lostAttempt = await waitForAttempt(lostCall.id);
      assert.equal(lostAttempt.leaseOwner, workerId);
      await source.query(`UPDATE agent_tool_attempts SET "leaseOwner"=$2,"leaseExpiresAt"=clock_timestamp()-interval '1 second' WHERE id=$1`,
        [lostAttempt.id, randomUUID()]);
      await assert.rejects(losing, /EXECUTION_CLAIM_LOST/);
      assert.equal((await store.get(userId, target.id, lostCall.id))?.status, 'EXECUTING');
      assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [lostAttempt.id]))[0].status, 'RESERVED');
      assert.deepEqual(await control.recoverExpired(userId), [lostAttempt.id]);
      assert.equal((await store.get(userId, target.id, lostCall.id))?.status, 'FAILED');
      assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [lostAttempt.id]))[0].status, 'SETTLED');
      assert.equal((await source.query('SELECT "errorCode" FROM agent_tool_results WHERE "attemptId"=$1', [lostAttempt.id]))[0].errorCode, 'READ_EXECUTION_INTERRUPTED');

      const notInvokedCall = await make('not-invoked', 'read_document');
      const started = await store.transition(userId, target.id, notInvokedCall.id, notInvokedCall.revision, { type: 'START' });
      const notInvokedAttempt = (await store.getAttempt(userId, target.id, started.id, started.attemptCount))!;
      await source.query(`UPDATE agent_tool_attempts SET "leaseOwner"=$2,"leaseExpiresAt"=clock_timestamp()-interval '1 second' WHERE id=$1`,
        [notInvokedAttempt.id, randomUUID()]);
      await source.query(`INSERT INTO agent_budget_reservations ("attemptId",status,"executionKind") VALUES ($1,'RESERVED','builtin_read')`, [notInvokedAttempt.id]);
      assert.deepEqual(await control.recoverExpired(userId), [notInvokedAttempt.id]);
      assert.equal((await store.get(userId, target.id, notInvokedCall.id))?.status, 'FAILED');
      assert.equal((await source.query('SELECT status FROM agent_budget_reservations WHERE "attemptId"=$1', [notInvokedAttempt.id]))[0].status, 'RELEASED');
      assert.equal((await source.query('SELECT "errorCode" FROM agent_tool_results WHERE "attemptId"=$1', [notInvokedAttempt.id]))[0].errorCode, 'READ_NOT_INVOKED_RECOVERED');
      await source.query('DELETE FROM agent_runs WHERE id=$1', [target.id]);
    });

    await t.test('有限安全重试、未知只读结果对账与确认过期维护循环', async () => {
      const docId = randomUUID();
      await source.query('INSERT INTO documents(id,"userId",title,content) VALUES ($1,$2,$3,$4)', [docId, userId, '重试测试', '重试正文']);
      let target = await writer.create(userId, { mode: 'task', goal: '重试与维护', workflowVersion: 'v1' });
      target = await writer.transition(userId, target.id, target, { type: 'ENQUEUE' });
      target = await writer.transition(userId, target.id, target, { type: 'START' });
      const catalog = new ToolCatalog();
      registerReadDocumentTool(catalog, source.manager);
      const original = catalog.resolve('read_document', '1');
      const context = { policy: { principal: { userId, permissions: ['documents:read'] }, allowedTools: ['read_document'] },
        scope: { allowOwnedLibrary: false, documentIds: [docId], folderIds: [] } };
      const make = async (key: string, name: string, requiresConfirmation = false) => {
        const call = await store.create(userId, { runId: target.id, callKey: key, origin: { kind: 'builtin' },
          prepared: { status: 'prepared', requiresConfirmation, call: { userId, name, version: '1', input: { id: docId } } } });
        return call;
      };

      let transientCalls = 0;
      catalog.register({ ...original.definition, name: 'flaky_read', timeoutMs: 500, retryPolicy: 'safe' },
        { name: 'flaky_read', version: '1', origin: { kind: 'builtin' }, resources: original.resources,
          execute: async (input, ctx) => {
            transientCalls += 1;
            if (transientCalls === 1) throw new Error('temporary');
            return original.execute(input, ctx);
          } });
      const flaky = await make('flaky', 'flaky_read');
      await new ToolAuthorization(source.manager, catalog).authorize(userId, target.id, flaky.id,
        { ...context, policy: { ...context.policy, allowedTools: ['flaky_read'] } });
      const executor = new ToolExecutor(source.manager, catalog,
        { maxAttempts: 3, retryBaseDelayMs: 10, retryMaxDelayMs: 20, leaseDurationMs: 500, heartbeatIntervalMs: 50 });
      const retried = await executor.execute(userId, target.id, flaky.id,
        { ...context, policy: { ...context.policy, allowedTools: ['flaky_read'] } });
      assert.equal(retried.call.status, 'SUCCEEDED');
      assert.equal(retried.call.attemptCount, 2);
      assert.equal(transientCalls, 2);
      const flakyResults = await source.query(`SELECT r."errorCode" FROM agent_tool_results r JOIN agent_tool_attempts a ON a.id=r."attemptId"
        WHERE a."callId"=$1 ORDER BY a."attemptNumber"`, [flaky.id]);
      assert.deepEqual(flakyResults.map((row: { errorCode: string | null }) => row.errorCode), ['TOOL_EXECUTION_FAILED', null]);

      catalog.register({ ...original.definition, name: 'exhausted_read', timeoutMs: 500, retryPolicy: 'safe' },
        { name: 'exhausted_read', version: '1', origin: { kind: 'builtin' }, resources: original.resources,
          execute: async () => { throw new Error('still temporary'); } });
      const exhausted = await make('exhausted', 'exhausted_read');
      await new ToolAuthorization(source.manager, catalog).authorize(userId, target.id, exhausted.id,
        { ...context, policy: { ...context.policy, allowedTools: ['exhausted_read'] } });
      const exhaustedResult = await new ToolExecutor(source.manager, catalog,
        { maxAttempts: 2, retryBaseDelayMs: 10, retryMaxDelayMs: 20 }).execute(userId, target.id, exhausted.id,
        { ...context, policy: { ...context.policy, allowedTools: ['exhausted_read'] } });
      assert.equal(exhaustedResult.call.status, 'FAILED');
      assert.equal(exhaustedResult.call.attemptCount, 2);

      const recovered = await make('reconcile', 'read_document');
      await new ToolAuthorization(source.manager, catalog).authorize(userId, target.id, recovered.id, context);
      const started = await store.transition(userId, target.id, recovered.id, 1, { type: 'START' });
      const attempt = (await store.getAttempt(userId, target.id, recovered.id, started.attemptCount))!;
      await source.query(`UPDATE agent_tool_attempts SET "leaseOwner"=$2,"leaseExpiresAt"=clock_timestamp()-interval '1 second',
        "invocationStartedAt"=clock_timestamp()-interval '2 seconds' WHERE id=$1`, [attempt.id, randomUUID()]);
      await source.query(`INSERT INTO agent_budget_reservations ("attemptId",status,"executionKind") VALUES ($1,'RESERVED','builtin_read')`, [attempt.id]);
      const control = new ToolExecutionControl(source.manager,
        { catalog, maxAttempts: 3, retryBaseDelayMs: 10, retryMaxDelayMs: 20 });
      assert.deepEqual(await control.recoverExpired(userId), [attempt.id]);
      assert.equal((await store.get(userId, target.id, recovered.id))?.status, 'RETRY_WAIT');
      assert.equal((await source.query('SELECT status FROM agent_tool_attempts WHERE id=$1', [attempt.id]))[0].status, 'FAILED');
      assert.equal((await source.query('SELECT "errorCode" FROM agent_tool_results WHERE "attemptId"=$1', [attempt.id]))[0].errorCode,
        'READ_OUTCOME_RECONCILED_RETRY');
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(await control.advanceDueRetries(), [recovered.id]);
      const recoveredResult = await executor.execute(userId, target.id, recovered.id, context);
      assert.equal(recoveredResult.call.status, 'SUCCEEDED');
      assert.equal(recoveredResult.call.attemptCount, 2);

      catalog.register({ ...original.definition, name: 'confirm_read', requiresConfirmation: true },
        { name: 'confirm_read', version: '1', origin: { kind: 'builtin' }, resources: original.resources, execute: original.execute });
      const pending = await make('expire-maintenance', 'confirm_read', true);
      const auth = new ToolAuthorization(source.manager, catalog);
      await auth.authorize(userId, target.id, pending.id,
        { ...context, policy: { ...context.policy, allowedTools: ['confirm_read'] } });
      await source.query(`UPDATE agent_confirmations SET "createdAt"=clock_timestamp()-interval '2 minutes',
        "expiresAt"=clock_timestamp()-interval '1 minute' WHERE "callId"=$1`, [pending.id]);
      // 轮询由应用调度循环驱动；这里直接重复单轮入口，验证维护逻辑本身仍能处理到期确认。
      const maintenance = new ToolExecutionMaintenance(source.manager, catalog,
        { batchSize: 10, retryBaseDelayMs: 10, retryMaxDelayMs: 20 });
      const deadline = Date.now() + 2000;
      for (;;) {
        await maintenance.runOnce();
        if ((await store.get(userId, target.id, pending.id))?.status === 'EXPIRED') break;
        assert.ok(Date.now() < deadline, '维护单轮应自动处理到期确认');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal((await source.query('SELECT status FROM agent_confirmations WHERE "callId"=$1', [pending.id]))[0].status, 'EXPIRED');
      await source.query('DELETE FROM agent_runs WHERE id=$1', [target.id]);
    });

    await t.test('尝试迁移可独立撤销和重建', async () => {
      const migrationRunner = source.createQueryRunner();
      try {
        await new AddAgentRetryScheduling1789862400000().down(migrationRunner);
        await new AddAgentExecutionRecovery1789776000000().down(migrationRunner);
        await new AddAgentReadExecution1789689600000().down(migrationRunner);
        await new CreateAgentConfirmations1789603200000().down(migrationRunner);
        await new CreateAgentToolAttempts1789516800000().down(migrationRunner);
        assert.equal((await migrationRunner.query("SELECT to_regclass('agent_tool_attempts') AS name"))[0].name, null);
        await new CreateAgentToolAttempts1789516800000().up(migrationRunner);
        await new CreateAgentConfirmations1789603200000().up(migrationRunner);
        await new AddAgentReadExecution1789689600000().up(migrationRunner);
        await new AddAgentExecutionRecovery1789776000000().up(migrationRunner);
        await new AddAgentRetryScheduling1789862400000().up(migrationRunner);
        assert.equal(await source.getRepository(AgentToolAttempt).count(), 0);
      } finally { await migrationRunner.release(); }
    });
  } finally {
    if (source.isInitialized) await source.destroy();
    // 名称只由本测试 UUID 生成；仅清理本次创建的 schema，不触及其他表。
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.destroy(); }
  }
});
