/** 会话/消息专用 PostgreSQL 验证；仅使用随机 schema，不读取或迁移业务库。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DataSource } from 'typeorm';

import { AgentConversationStore } from './agent-conversation.store';
import { deleteAgentData } from './agent-data.cleanup';
import { exportAgentData } from './agent-data.exporter';
import { AgentMessage } from './entity/agent-message.entity';
import { AgentRun } from './entity/agent-run.entity';
import { AgentThread } from './entity/agent-thread.entity';
import { CreateAgentRuns1789344000000 } from '../../migrations/1789344000000-CreateAgentRuns';
import { CreateAgentEvents1789344001000 } from '../../migrations/1789344001000-CreateAgentEvents';
import { AddAgentEventSequence1789430400000 } from '../../migrations/1789430400000-AddAgentEventSequence';
import { CreateAgentConversations1789948800000 } from '../../migrations/1789948800000-CreateAgentConversations';

test('Agent Thread/Message：请求去重、Run 绑定、归属、导出与清理', {
  skip: process.env.RUN_INTEGRATION_TESTS !== '1', timeout: 30000,
}, async () => {
  const schema = `agent_conversation_test_${randomUUID().replaceAll('-', '')}`;
  const connection = { type: 'postgres' as const, host: '127.0.0.1', port: 5433,
    username: 'inkweaver_test', password: 'inkweaver_test', database: 'syncbox_test',
    synchronize: false, connectTimeoutMS: 5000 };
  const admin = await new DataSource(connection).initialize();
  const source = new DataSource({ ...connection, schema, entities: [AgentThread, AgentMessage, AgentRun],
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
      await new CreateAgentConversations1789948800000().up(runner);
      await runner.query(`ALTER TABLE agent_runs
        ADD COLUMN "revisionArtifactId" uuid, ADD COLUMN "revisionBaseVersion" integer,
        ADD COLUMN "revisionRange" jsonb,
        ADD COLUMN "checkpointKey" text GENERATED ALWAYS AS ("userId"::text || ':' || id::text) STORED,
        ADD CONSTRAINT "UQ_agent_runs_checkpoint_key" UNIQUE ("checkpointKey"),
        ADD COLUMN "executionPaused" boolean NOT NULL DEFAULT true,
        ADD COLUMN "cancelRequested" boolean NOT NULL DEFAULT false,
        ADD COLUMN "lastErrorCode" varchar(64),
        ADD COLUMN "nextDispatchAt" timestamptz NOT NULL DEFAULT clock_timestamp()`);
    } finally { await runner.release(); }

    const userId = randomUUID();
    const otherUser = randomUUID();
    await source.query('INSERT INTO users(id) VALUES ($1),($2)', [userId, otherUser]);
    const conversations = new AgentConversationStore(source.manager);
    const thread = await conversations.createThread(userId, 'Agent 会话');
    assert.equal(thread.userId, userId);
    assert.equal(thread.title, 'Agent 会话');

    const request = { threadId: thread.id, requestKey: 'request-1', mode: 'dialogue' as const,
      workflowVersion: 'v1', content: [{ type: 'text', text: '综合这批资料' }] };
    const first = await conversations.appendUserMessageAndCreateRun(userId, request);
    assert.equal(first.replayed, false);
    assert.equal(first.message.role, 'user');
    assert.equal(first.message.runId, first.run.id);
    assert.equal(first.run.threadId, thread.id);
    assert.equal(first.run.triggerMessageId, first.message.id);
    assert.equal(first.run.goal, '综合这批资料');
    assert.equal((await source.query('SELECT count(*)::int AS count FROM agent_events WHERE "runId"=$1', [first.run.id]))[0].count, 1);

    const replayed = await conversations.appendUserMessageAndCreateRun(userId, request);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.message.id, first.message.id);
    assert.equal(replayed.run.id, first.run.id);
    assert.equal((await source.query('SELECT count(*)::int AS count FROM agent_messages WHERE "threadId"=$1', [thread.id]))[0].count, 1);
    assert.equal((await source.query('SELECT count(*)::int AS count FROM agent_runs WHERE "threadId"=$1', [thread.id]))[0].count, 1);

    await assert.rejects(conversations.appendUserMessageAndCreateRun(userId,
      { ...request, content: [{ type: 'text', text: '不同正文' }] }), /AGENT_REQUEST_KEY_CONFLICT/);
    await assert.rejects(conversations.appendUserMessageAndCreateRun(otherUser, request), /THREAD_NOT_ACCEPTING_MESSAGES/);
    await assert.rejects(conversations.appendUserMessageAndCreateRun(userId,
      { ...request, requestKey: 'media', content: [{ type: 'file', asset: { assetId: 'a', mimeType: 'text/plain', sizeBytes: 1, status: 'ready' } }] }),
    /INVALID_AGENT_CONVERSATION_INPUT/);

    const assistant = await conversations.appendAssistantMessage(userId, thread.id, first.run.id,
      [{ type: 'text', text: '已收到，准备处理。' }]);
    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.runId, first.run.id);
    assert.deepEqual((await conversations.listMessages(userId, thread.id)).map((item) => item.id), [first.message.id, assistant.id]);
    assert.deepEqual(await conversations.listMessages(otherUser, thread.id), []);

    const secondRequest = { ...request, requestKey: 'request-2', content: [{ type: 'text', text: '第二个任务' }] };
    const [a, b] = await Promise.all([
      conversations.appendUserMessageAndCreateRun(userId, secondRequest),
      conversations.appendUserMessageAndCreateRun(userId, secondRequest),
    ]);
    assert.equal(a.run.id, b.run.id);
    assert.equal([a.replayed, b.replayed].filter(Boolean).length, 1);

    const exported = await exportAgentData(source.manager, userId);
    assert.equal(exported.threads.length, 1);
    assert.equal(exported.messages.length, 3);
    assert.equal(exported.runs.length, 2);
    assert.ok(!(exported.messages[0] as Record<string, unknown>).requestDigest);
    assert.equal((await exportAgentData(source.manager, otherUser)).threads.length, 0);

    const cleanupRunner = source.createQueryRunner();
    await cleanupRunner.startTransaction();
    try {
      await assert.rejects(deleteAgentData(cleanupRunner.manager, userId), /未结束/);
      await cleanupRunner.rollbackTransaction();
    } finally { await cleanupRunner.release(); }

    await source.query("UPDATE agent_runs SET status='FAILED' WHERE \"userId\"=$1", [userId]);
    const settledRunner = source.createQueryRunner();
    await settledRunner.startTransaction();
    try {
      await deleteAgentData(settledRunner.manager, userId);
      await settledRunner.commitTransaction();
    } finally {
      if (settledRunner.isTransactionActive) await settledRunner.rollbackTransaction();
      await settledRunner.release();
    }
    assert.equal((await source.query('SELECT count(*)::int AS count FROM agent_threads WHERE "userId"=$1', [userId]))[0].count, 0);
    assert.equal((await source.query('SELECT count(*)::int AS count FROM agent_messages WHERE "userId"=$1', [userId]))[0].count, 0);
    assert.equal((await source.query('SELECT count(*)::int AS count FROM agent_runs WHERE "userId"=$1', [userId]))[0].count, 0);
  } finally {
    if (source.isInitialized) await source.destroy();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.destroy(); }
  }
});
