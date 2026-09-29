/** 用户发起的保存工作流：固定草稿、请求确认、原子提交；不调用模型，不以模型文本替代用户批准。 */
import { AgentConversationStore } from './agent-conversation.store';
import { lockAgentOwner } from './agent-data.cleanup';
import { AgentDocumentSaveStore } from './agent-document-save.store';
import { AgentDocumentWriter } from './agent-document.writer';
import { AgentRunWriter } from './agent-run.writer';
import { AgentDocumentSave } from './entity/agent-document-save.entity';
import { AgentRun } from './entity/agent-run.entity';
import { ToolAuthorization } from './tools/tool-authorization';
import { ToolCallPreparer } from './tools/tool-call-preparer';
import { ToolCallStore } from './tools/tool-call.store';

import type { PrepareAgentDocumentSave } from './agent-document-save.store';
import type { ToolAuthorizationContext } from './tools/tool-authorization';
import type { ToolCatalog } from './tools/tool-catalog';
import type { EntityManager } from 'typeorm';

export class AgentSaveService {
  constructor(private readonly manager: EntityManager, private readonly catalog: ToolCatalog) {}

  /** 整体准备同事务提交；请求重放返回相同 Run/保存记录/确认，不创建第二份文档。 */
  async prepare(userId: string, threadId: string, input: PrepareAgentDocumentSave, context: ToolAuthorizationContext) {
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const record = await new AgentConversationStore(manager).appendUserMessageAndCreateRun(userId, {
        threadId, requestKey: input.requestKey, mode: 'task', workflowVersion: 'agent-save-v1',
        content: [{ type: 'text', text: `保存草稿：${JSON.stringify({ version: input.artifactVersionId, folder: input.folderId })}` }],
      });
      const writer = new AgentRunWriter(manager);
      let run = record.run;
      if (record.replayed) {
        const save = await manager.getRepository(AgentDocumentSave).findOneByOrFail({ userId, runId: run.id });
        return { run, save };
      }
      run = await writer.transition(userId, run.id, run, { type: 'ENQUEUE' });
      run = await writer.transition(userId, run.id, run, { type: 'START' });
      const save = await new AgentDocumentSaveStore(manager).prepare(userId, run.id, input, context.scope);
      const prepared = new ToolCallPreparer(this.catalog).prepare({ name: 'create_document', expectedVersion: '1',
        input: { saveId: save.id, saveDigest: save.digest, folderId: save.folderId } }, context.policy);
      if (prepared.status !== 'prepared') throw new Error('AGENT_SAVE_NOT_ALLOWED');
      const call = await new ToolCallStore(manager).create(userId, { runId: run.id, callKey: `save:${save.id}`, origin: { kind: 'builtin' }, prepared });
      await new ToolAuthorization(manager, this.catalog).authorize(userId, run.id, call.id, context);
      run = await writer.transition(userId, run.id, run, { type: 'WAIT_FOR_CONFIRMATION' });
      return { run, save };
    });
  }

  /** 已批准保存的重试入口。确认仍有时效；数据库回滚后复用原绑定，不生成新操作或新文档 ID。 */
  async execute(userId: string, runId: string, context: ToolAuthorizationContext) {
    const save = await this.manager.getRepository(AgentDocumentSave).findOneByOrFail({ userId, runId });
    const calls: Array<{ id: string; status: string }> = await this.manager.query(`SELECT id,status FROM agent_tool_calls
      WHERE "userId"=$1 AND "runId"=$2 AND "callKey"=$3`, [userId, runId, `save:${save.id}`]);
    if (calls.length !== 1) throw new Error('AGENT_SAVE_CALL_MISMATCH');
    const call = calls[0]!;
    if (!['READY', 'SUCCEEDED'].includes(call.status)) throw new Error('AGENT_SAVE_CONFIRMATION_REQUIRED');
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      let run = await manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
      if (run.workflowVersion !== 'agent-save-v1') throw new Error('AGENT_SAVE_CALL_MISMATCH');
      const writer = new AgentRunWriter(manager);
      if (run.status === 'WAITING_CONFIRMATION') run = await writer.transition(userId, runId, run, { type: 'CONFIRMATION_ACCEPTED' });
      if (run.status === 'QUEUED') await writer.transition(userId, runId, run, { type: 'START' });
    });
    const output = await new AgentDocumentWriter(this.manager, this.catalog).save(userId, runId, call.id, save.id, context);
    // 保存事实已提交、Run 收尾前崩溃可再次进入；Writer 重放只读同一文档。
    await this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const run = await manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
      if (run.status === 'COMPLETED' || run.status === 'CANCELLED') return;
      await new AgentConversationStore(manager).appendAssistantMessage(userId, save.threadId, runId,
        [{ type: 'text', text: `已保存文档：${output.documentId}` }]);
      await new AgentRunWriter(manager).transition(userId, runId, run, { type: 'COMPLETE' });
    });
    return output;
  }
}
