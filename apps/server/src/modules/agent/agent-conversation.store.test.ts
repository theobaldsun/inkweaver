import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource } from 'typeorm';

import { AgentConversationStore, AgentConversationStoreError } from './agent-conversation.store';
import { AgentMessage } from './entity/agent-message.entity';
import { AgentRun } from './entity/agent-run.entity';
import { AgentThread } from './entity/agent-thread.entity';

import type { EntityManager } from 'typeorm';

class OfflineSource extends DataSource {
  /** 仅构建实体元数据，不连接数据库。 */
  async prepare(): Promise<void> { await this.buildMetadatas(); }
}

const userId = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';

test('Thread、Message 与 Run 关联字段使用显式数据库类型', async () => {
  const source = new OfflineSource({ type: 'postgres', entities: [AgentThread, AgentMessage, AgentRun], synchronize: false });
  await source.prepare();
  const message = source.getMetadata(AgentMessage);
  const run = source.getMetadata(AgentRun);
  assert.equal(message.findColumnWithPropertyName('content')?.type, 'jsonb');
  assert.equal(message.findColumnWithPropertyName('requestDigest')?.length, '64');
  assert.equal(message.findColumnWithPropertyName('runId')?.isNullable, true);
  assert.equal(run.findColumnWithPropertyName('threadId')?.isNullable, true);
  assert.equal(run.findColumnWithPropertyName('triggerMessageId')?.isNullable, true);
});

test('非法会话输入在访问数据库前拒绝，媒体默认未开放', async () => {
  const store = new AgentConversationStore({} as EntityManager);
  await assert.rejects(store.createThread('bad-id', 'x'), AgentConversationStoreError);
  await assert.rejects(store.createThread(userId, ' '.repeat(3)), AgentConversationStoreError);
  await assert.rejects(store.appendAssistantMessage(userId, threadId, 'bad-run', [{ type: 'text', text: 'x' }]), AgentConversationStoreError);
  await assert.rejects(store.appendUserMessageAndCreateRun(userId, {
    threadId, requestKey: 'request-1', mode: 'dialogue', workflowVersion: 'v1',
    content: [{ type: 'file', asset: { assetId: 'a', mimeType: 'text/plain', sizeBytes: 1, status: 'ready' } }],
  }), AgentConversationStoreError);
  await assert.rejects(store.appendUserMessageAndCreateRun(userId, {
    threadId, requestKey: 'request-2', mode: 'dialogue', workflowVersion: 'v1', content: [{ type: 'text', text: '   ' }],
  }), AgentConversationStoreError);
  await assert.rejects(store.listMessages(userId, threadId, 101), AgentConversationStoreError);
  void runId;
});


test('修订请求必须绑定合法目标且使用任务修订工作流', async () => {
  const store = new AgentConversationStore({} as EntityManager);
  const request = { threadId, requestKey: 'revision', mode: 'task' as const, workflowVersion: 'agent-revise-v1', content: [{ type: 'text', text: '调整结论' }] };
  for (const change of [{}, { revisionTarget: { artifactId: runId, baseVersion: 0 } },
    { revisionTarget: { artifactId: runId, baseVersion: 50 } },
    { workflowVersion: 'agent-task-v1', revisionTarget: { artifactId: runId, baseVersion: 2 } },
    { mode: 'dialogue' as const, revisionTarget: { artifactId: runId, baseVersion: 2 } }]) {
    await assert.rejects(store.appendUserMessageAndCreateRun(userId, { ...request, ...change }), AgentConversationStoreError);
  }
});
