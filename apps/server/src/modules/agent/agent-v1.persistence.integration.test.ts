/** v1 统一验收：真实 PostgreSQL 随机隔离 schema + 本地模型替身，禁止供应商调用。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DataSource } from 'typeorm';
import * as Y from 'yjs';

import { createAgentCheckpointer } from './agent-checkpointer';
import { AgentConversationStore } from './agent-conversation.store';
import { deleteAgentData } from './agent-data.cleanup';
import { exportAgentData } from './agent-data.exporter';
import { AgentGraphRunner } from './agent-graph.runner';
import { AgentModelCallRecorder } from './agent-model-call.recorder';
import { AgentSaveService } from './agent-save.service';
import { AgentService } from './agent.service';
import { AgentArtifactSource } from './entity/agent-artifact-source.entity';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentArtifact } from './entity/agent-artifact.entity';
import { AgentDocumentSave } from './entity/agent-document-save.entity';
import { AgentMessage } from './entity/agent-message.entity';
import { AgentModelCall } from './entity/agent-model-call.entity';
import { AgentRunSource } from './entity/agent-run-source.entity';
import { AgentRun } from './entity/agent-run.entity';
import { AgentThread } from './entity/agent-thread.entity';
import { AgentToolAttempt } from './entity/agent-tool-attempt.entity';
import { AgentToolCall } from './entity/agent-tool-call.entity';
import { CreateAgentRuns1789344000000 } from '../../migrations/1789344000000-CreateAgentRuns';
import { CreateAgentEvents1789344001000 } from '../../migrations/1789344001000-CreateAgentEvents';
import { AddAgentEventSequence1789430400000 } from '../../migrations/1789430400000-AddAgentEventSequence';
import { CreateAgentToolCalls1789430401000 } from '../../migrations/1789430401000-CreateAgentToolCalls';
import { CreateAgentToolAttempts1789516800000 } from '../../migrations/1789516800000-CreateAgentToolAttempts';
import { CreateAgentConfirmations1789603200000 } from '../../migrations/1789603200000-CreateAgentConfirmations';
import { AddAgentReadExecution1789689600000 } from '../../migrations/1789689600000-AddAgentReadExecution';
import { AddAgentExecutionRecovery1789776000000 } from '../../migrations/1789776000000-AddAgentExecutionRecovery';
import { AddAgentRetryScheduling1789862400000 } from '../../migrations/1789862400000-AddAgentRetryScheduling';
import { CreateAgentConversations1789948800000 } from '../../migrations/1789948800000-CreateAgentConversations';
import { CreateAgentRunSources1790035200000 } from '../../migrations/1790035200000-CreateAgentRunSources';
import { CreateAgentCheckpoints1790121600000 } from '../../migrations/1790121600000-CreateAgentCheckpoints';
import { AddAgentSourceCitationLabels1790208000000 } from '../../migrations/1790208000000-AddAgentSourceCitationLabels';
import { CreateAgentModelCalls1790294400000 } from '../../migrations/1790294400000-CreateAgentModelCalls';
import { AddAgentToolSources1790380800000 } from '../../migrations/1790380800000-AddAgentToolSources';
import { CreateAgentArtifacts1790467200000 } from '../../migrations/1790467200000-CreateAgentArtifacts';
import { AddAgentRevisionTarget1790553600000 } from '../../migrations/1790553600000-AddAgentRevisionTarget';
import { AddAgentRevisionRange1790640000000 } from '../../migrations/1790640000000-AddAgentRevisionRange';
import { AddAgentArtifactEvidence1790726400000 } from '../../migrations/1790726400000-AddAgentArtifactEvidence';
import { CreateAgentDocumentSaves1790812800000 } from '../../migrations/1790812800000-CreateAgentDocumentSaves';
import { AddAgentDocumentSaveCommit1790899200000 } from '../../migrations/1790899200000-AddAgentDocumentSaveCommit';
import { AddAgentModelBudgets1790985600000 } from '../../migrations/1790985600000-AddAgentModelBudgets';
import { AddAgentDispatch1791072000000 } from '../../migrations/1791072000000-AddAgentDispatch';
import { AddAgentStorageAndIndexing1791158400000 } from '../../migrations/1791158400000-AddAgentStorageAndIndexing';
import { Session } from '../auth/entity/session.entity';
import { Document } from '../documents/entity/document.entity';
import { SearchHistory } from '../search/entity/search-history.entity';
import { DocSnapshot } from '../sync/entity/doc-snapshot.entity';
import { SyncUpdate } from '../sync/entity/sync-update.entity';
import { User } from '../users/entity/user.entity';

import type { AgentKnowledgeService } from './agent-knowledge.service';
import type { AgentModelClient, AgentModelStepRequest } from './agent-model.client';
import type { DocumentIndexService } from '../ai/document-index.service';
import type { QueryRunner } from 'typeorm';

const migrationTypes = [
  CreateAgentRuns1789344000000,
  CreateAgentEvents1789344001000,
  AddAgentEventSequence1789430400000,
  CreateAgentToolCalls1789430401000,
  CreateAgentToolAttempts1789516800000,
  CreateAgentConfirmations1789603200000,
  AddAgentReadExecution1789689600000,
  AddAgentExecutionRecovery1789776000000,
  AddAgentRetryScheduling1789862400000,
  CreateAgentConversations1789948800000,
  CreateAgentRunSources1790035200000,
  CreateAgentCheckpoints1790121600000,
  AddAgentSourceCitationLabels1790208000000,
  CreateAgentModelCalls1790294400000,
  AddAgentToolSources1790380800000,
  CreateAgentArtifacts1790467200000,
  AddAgentRevisionTarget1790553600000,
  AddAgentRevisionRange1790640000000,
  AddAgentArtifactEvidence1790726400000,
  CreateAgentDocumentSaves1790812800000,
  AddAgentDocumentSaveCommit1790899200000,
  AddAgentModelBudgets1790985600000,
  AddAgentDispatch1791072000000,
  AddAgentStorageAndIndexing1791158400000
];
const entities = [AgentArtifactSource, AgentArtifactVersion, AgentArtifact, AgentDocumentSave, AgentMessage, AgentModelCall, AgentRunSource, AgentRun, AgentThread, AgentToolAttempt, AgentToolCall, User, Document, Session, SearchHistory, DocSnapshot, SyncUpdate];

test('Agent v1：完整迁移、离线生成、确认保存、并发幂等、配额、取消与清理', {
  // 统一入口覆盖完整保存链路，同时兼容原有定向验收开关。
  skip: process.env.RUN_INTEGRATION_TESTS !== '1' && process.env.RUN_AGENT_V1_INTEGRATION !== '1', timeout: 90000,
}, async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `agent_v1_${suffix}`;
  const checkpointSchema = `agent_cp_${suffix}`;
  const connection = { type: 'postgres' as const, host: '127.0.0.1', port: 5433,
    username: 'inkweaver_test', password: 'inkweaver_test', database: 'syncbox_test', synchronize: false, connectTimeoutMS: 5000 };
  const admin = await new DataSource(connection).initialize();
  const source = new DataSource({ ...connection, schema, entities,
    extra: { options: `-c search_path=${schema} -c statement_timeout=15000`, max: 12 } });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await source.initialize();
    const originalQuery = source.query.bind(source);
    source.query = ((sql: string, parameters?: unknown[], queryRunner?: QueryRunner) =>
      originalQuery(sql.replaceAll('agent_checkpoint', checkpointSchema), parameters, queryRunner)) as typeof source.query;
    await source.query(`CREATE TABLE users (id uuid PRIMARY KEY, "storageQuotaBytes" bigint NOT NULL DEFAULT 1073741824);
      CREATE TABLE folders(id uuid PRIMARY KEY,"userId" uuid,name text,"parentId" uuid);
      CREATE TABLE documents(id uuid PRIMARY KEY,"userId" uuid NOT NULL,title varchar NOT NULL,content text NOT NULL,
        "isPublic" boolean DEFAULT false,"shareLink" varchar,tags jsonb,"folderId" uuid,"deletedAt" timestamptz,"deletedFromFolderId" uuid,
        "lastOpenedAt" timestamptz,"createdAt" timestamp DEFAULT now(),"updatedAt" timestamp DEFAULT now(),"docTsv" tsvector);
      CREATE TABLE sync_update("updateId" serial PRIMARY KEY,"docId" varchar NOT NULL,update text NOT NULL,timestamp bigint NOT NULL,
        "clientId" varchar,"createdAt" timestamp DEFAULT now());
      CREATE TABLE doc_snapshot(id serial PRIMARY KEY,"docId" varchar NOT NULL UNIQUE,snapshot text NOT NULL,version bigint DEFAULT 0,
        "updateCount" bigint DEFAULT 0,size bigint,"createdAt" timestamp DEFAULT now(),"updatedAt" timestamp DEFAULT now());`);
    const rawRunner = source.createQueryRunner();
    // 框架 schema 名也随机隔离；迁移 SQL 除固定 schema 标识替换外保持原样。
    const runner = new Proxy(rawRunner, { get(target, key) {
      if (key === 'query') return (sql: string, parameters?: unknown[]) => target.query(sql.replaceAll('agent_checkpoint', checkpointSchema), parameters);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as QueryRunner;
    try { for (const Migration of migrationTypes) await new Migration().up(runner); }
    finally { await rawRunner.release(); }

    const userId = randomUUID(), otherUser = randomUUID();
    await source.query('INSERT INTO users(id) VALUES ($1),($2)', [userId, otherUser]);
    const limits = { contextTokens: 12000, outputTokens: 2000, callsPerRun: 10, callsPerUserDay: 100,
      reservedTokensPerRun: 120000, reservedTokensPerUserDay: 1200000 };
    let modelCalls = 0;
    const model = { isConfigured: () => true, configuredModel: () => 'offline-fixture', limits: () => limits,
      async step(_request: AgentModelStepRequest) {
        modelCalls += 1;
        return { kind: 'answer' as const, text: modelCalls === 4 ? '{"schemaVersion":1,"status":"unverified","items":[]}' : '# 离线草稿\n合成内容。',
          model: 'offline-fixture', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, latencyMs: 0 };
      } } as unknown as AgentModelClient;
    const knowledge = { async prepare() { return { messages: [{ role: 'system', text: '离线规则' }, { role: 'user', text: '合成任务' }], sources: [] }; } } as unknown as AgentKnowledgeService;
    const index = { async scheduleReindex() { throw new Error('PROVIDER_CALL_FORBIDDEN'); } } as unknown as DocumentIndexService;
    const service = new AgentService(source, model, knowledge, index);
    assert.equal((await service.status()).ready, true);
    const conversation = new AgentConversationStore(source.manager);
    const thread = await conversation.createThread(userId, '离线验收');
    const submitted = await service.submit(userId, { threadId: thread.id, requestKey: 'task-1', mode: 'task', content: [{ type: 'text', text: '生成合成草稿' }] });
    const checkpointer = await createAgentCheckpointer((source.driver as unknown as { master: Parameters<typeof createAgentCheckpointer>[0] }).master, checkpointSchema);
    const graph = new AgentGraphRunner({ dataSource: source, catalog: service.catalog, knowledge, model, checkpointer, authorization: async (id) => service.context(id) });
    assert.equal(await graph.run(userId, submitted.run.id), 'completed');
    assert.equal(modelCalls, 4);
    assert.equal(await graph.run(userId, submitted.run.id), 'completed');
    assert.equal(modelCalls, 4);
    const versions = await source.getRepository(AgentArtifactVersion).find({ where: { runId: submitted.run.id }, order: { version: 'ASC' } });
    assert.equal(versions.length, 2);
    const draft = versions[1]!;
    const saveInput = { requestKey: 'save-1', artifactVersionId: draft.id, folderId: null };
    const [prepared, duplicate] = await Promise.all([service.prepareSave(userId, thread.id, saveInput), service.prepareSave(userId, thread.id, saveInput)]);
    assert.equal(prepared.run.id, duplicate.run.id);
    assert.equal(prepared.save.documentId, duplicate.save.documentId);
    await assert.rejects(service.prepareSave(otherUser, thread.id, saveInput));
    const saves = new AgentSaveService(source.manager, service.catalog);
    await assert.rejects(saves.execute(userId, prepared.run.id, service.context(userId, true)), /CONFIRMATION_REQUIRED/);
    const [confirmation] = await source.query('SELECT * FROM agent_confirmations WHERE "runId"=$1', [prepared.run.id]);
    await service.decide(userId, prepared.run.id, confirmation.callId, confirmation.id, true);
    const [first, second] = await Promise.all([saves.execute(userId, prepared.run.id, service.context(userId, true)), saves.execute(userId, prepared.run.id, service.context(userId, true))]);
    assert.equal(first.documentId, second.documentId);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM documents WHERE "userId"=$1', [userId]))[0].n, 1);
    const snapshot = await source.getRepository(DocSnapshot).findOneByOrFail({ docId: first.documentId });
    const ydoc = new Y.Doc();
    try { Y.applyUpdate(ydoc, Buffer.from(snapshot.snapshot, 'base64')); assert.equal(ydoc.getText('content').toString(), draft.content); }
    finally { ydoc.destroy(); }
    const resultRows = await source.query('SELECT * FROM agent_tool_results');
    assert.equal(resultRows.length, 1);
    await source.query('UPDATE documents SET "deletedAt"=now() WHERE id=$1', [first.documentId]);
    await assert.rejects(saves.execute(userId, prepared.run.id, service.context(userId, true)), /DOCUMENT_UNAVAILABLE/);

    // 低额度拒绝新增内容，同事务的用户消息和 Run 不留下半条记录。
    await source.query('UPDATE users SET "storageQuotaBytes"=1 WHERE id=$1', [userId]);
    await assert.rejects(service.submit(userId, { threadId: thread.id, requestKey: 'quota', mode: 'dialogue', content: [{ type: 'text', text: '拒绝内容' }] }), /STORAGE_QUOTA_EXCEEDED/);
    assert.equal((await source.query(`SELECT count(*)::int AS n FROM agent_messages WHERE "requestKey"='quota'`))[0].n, 0);
    await source.query('UPDATE users SET "storageQuotaBytes"=1073741824 WHERE id=$1', [userId]);

    // 真实用户锁确保最后一次调用额度不会被两个并发请求同时消费。
    const budgetRun = await service.submit(userId, { threadId: thread.id, requestKey: 'budget', mode: 'dialogue', content: [{ type: 'text', text: '额度测试' }] });
    await source.query(`UPDATE agent_runs SET status='RUNNING' WHERE id=$1`, [budgetRun.run.id]);
    const budgetClient = { configuredModel: () => 'offline-budget', limits: () => ({ ...limits, callsPerRun: 1 }), step: model.step.bind(model) };
    const recorder = new AgentModelCallRecorder(source.manager, budgetClient);
    const attempts = await Promise.allSettled([1,2].map(() => recorder.step(userId, budgetRun.run.id, { messages: [{ role: 'user', text: '合成' }], maxOutputTokens: 10 })));
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM agent_model_calls WHERE "runId"=$1', [budgetRun.run.id]))[0].n, 1);
    await service.cancel(userId, budgetRun.run.id);
    // 关闭替身模型，确保维护取消不会触发知识、索引或模型调用。
    model.isConfigured = () => false;
    await service.tick();
    assert.equal((await source.getRepository(AgentRun).findOneByOrFail({ id: budgetRun.run.id })).status, 'CANCELLED');
    const exported = await exportAgentData(source.manager, userId);
    assert.equal(exported.documentSaves.length, 1);
    assert.equal(exported.artifactVersions.length, 2);
    assert.equal((await exportAgentData(source.manager, otherUser)).runs.length, 0);
    await source.transaction('READ COMMITTED', (manager) => deleteAgentData(manager, userId));
    assert.equal((await source.query('SELECT count(*)::int AS n FROM agent_runs'))[0].n, 0);
    assert.equal((await source.query(`SELECT count(*)::int AS n FROM ${checkpointSchema}.checkpoints`))[0].n, 0);
  } finally {
    if (source.isInitialized) await source.destroy();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${checkpointSchema}" CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await admin.destroy(); }
  }
});
