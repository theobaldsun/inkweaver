/** Agent 内部原子文档写入：确认复核、文档/同步初始化、保存事实、调用结果和预算同事务提交。 */
import * as Y from 'yjs';

import { lockAgentOwner } from './agent-data.cleanup';
import { AgentDocumentSaveStore } from './agent-document-save.store';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentDocumentSave } from './entity/agent-document-save.entity';
import { ToolAuthorization } from './tools/tool-authorization';
import { ToolCallStore } from './tools/tool-call.store';
import { Document } from '../documents/entity/document.entity';
import { DocSnapshot } from '../sync/entity/doc-snapshot.entity';
import { SyncUpdate } from '../sync/entity/sync-update.entity';

import type { ToolAuthorizationContext } from './tools/tool-authorization';
import type { ToolCatalog } from './tools/tool-catalog';
import type { EntityManager } from 'typeorm';

/** 与现有文档创建路径使用同一 content/metadata Yjs 布局；Markdown 正文按原字符串保存。 */
export function createAgentDocumentSnapshot(title: string, content: string): { snapshot: string; size: number } {
  const doc = new Y.Doc();
  try {
    doc.getText('content').insert(0, content);
    doc.getMap('metadata').set('title', title);
    const bytes = Y.encodeStateAsUpdate(doc);
    return { snapshot: Buffer.from(bytes).toString('base64'), size: bytes.byteLength };
  } finally { doc.destroy(); }
}

export class AgentDocumentWriter {
  constructor(private readonly manager: EntityManager, private readonly catalog: ToolCatalog) {}

  /**
   * 仅接受可信目录中的 create_document v1、builtin/L1、强制确认调用。
   * 不调用事务外适配器；本地数据库写入可以在单事务完成，不产生可接管的中间副作用。
   * 已提交同调用重放只读取保存事实；目标文档被删除时明确报错，绝不重新建一份。
   */
  async save(userId: string, runId: string, callId: string, saveId: string, context: ToolAuthorizationContext): Promise<{ documentId: string }> {
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (![userId, runId, callId, saveId].every((id) => uuid.test(id)) || context.policy.principal?.userId !== userId) throw new Error('INVALID_AGENT_SAVE_EXECUTION');
    if (this.manager.queryRunner?.isTransactionActive) throw new Error('EXECUTION_REQUIRES_ROOT_MANAGER');
    const authorization = structuredClone(context);
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      // 所有工作都是本地 SQL；限制单语句等待时间，不在行锁内调用模型或外部服务。
      await manager.query(`SET LOCAL statement_timeout = '10s'`);
      await lockAgentOwner(manager, userId);
      const saves = manager.getRepository(AgentDocumentSave);
      const save = await saves.findOneBy({ id: saveId, userId, runId });
      if (!save) throw new Error('AGENT_SAVE_NOT_AVAILABLE');
      const calls = new ToolCallStore(manager);
      if (save.status === 'SAVED') {
        const call = await calls.get(userId, runId, callId);
        if (save.savedCallId !== callId || call?.status !== 'SUCCEEDED' || call.sideEffect !== 'committed') throw new Error('AGENT_SAVE_COMMIT_INCONSISTENT');
        const document = await manager.getRepository(Document).findOneBy({ id: save.documentId, userId });
        if (!document || document.deletedAt) throw new Error('AGENT_SAVED_DOCUMENT_UNAVAILABLE');
        return { documentId: document.id };
      }
      const [runIntent] = await manager.query('SELECT "cancelRequested" FROM agent_runs WHERE id=$1 AND "userId"=$2', [runId, userId]);
      if (!runIntent || runIntent.cancelRequested) throw new Error('AGENT_SAVE_CANCELLED');
      const checked = await new ToolAuthorization(manager, this.catalog).recheck(userId, runId, callId, authorization);
      const tool = this.catalog.resolve(checked.call.toolName, checked.call.toolVersion);
      const input = checked.call.input as Record<string, unknown>;
      if (checked.call.toolName !== 'create_document' || checked.call.toolVersion !== '1'
        || tool.definition.origin.kind !== 'builtin' || tool.definition.riskLevel !== 'L1'
        || !tool.definition.requiresConfirmation || !checked.call.requiresConfirmation
        || !input || input.saveId !== save.id || input.saveDigest !== save.digest || input.folderId !== save.folderId) throw new Error('AGENT_SAVE_CALL_MISMATCH');
      // 复用保存准备的版本/目录/来源复核，但不重复预留文档：仍使用原先预留的 ID。
      // verify 只在本事务内读取，不再开启嵌套事务，也不产生第二条保存绑定。
      const binding = await new AgentDocumentSaveStore(manager).verify(userId, runId, {
        requestKey: save.requestKey, artifactVersionId: save.artifactVersionId, folderId: save.folderId,
      }, authorization.scope);
      // 摘要不变才算同一固定绑定；版本归属与来源访问性已在 verify 内复核。
      if (binding.digest !== save.digest) throw new Error('AGENT_SAVE_REQUEST_CONFLICT');
      const version = await manager.getRepository(AgentArtifactVersion).findOneByOrFail({ id: save.artifactVersionId, userId, threadId: save.threadId });
      const output = { documentId: save.documentId };
      const serialized = JSON.stringify(output);
      if (!tool.validateOutput(output).ok || Buffer.byteLength(serialized, 'utf8') > tool.definition.maxOutputBytes) throw new Error('INVALID_AGENT_SAVE_OUTPUT');
      const [budget] = await manager.query(`SELECT r."toolCallLimit" AS limit,
        (SELECT count(*)::integer FROM agent_budget_reservations b JOIN agent_tool_attempts a ON a.id=b."attemptId"
          WHERE a."runId"=r.id AND b.status<>'RELEASED') AS used FROM agent_runs r WHERE r.id=$1 AND r."userId"=$2`, [runId, userId]);
      if (!budget || budget.used >= budget.limit) throw new Error('TOOL_BUDGET_EXHAUSTED');
      const call = await calls.transition(userId, runId, callId, checked.call.revision, { type: 'START' });
      const attempt = await calls.getAttempt(userId, runId, callId, call.attemptCount);
      if (!attempt) throw new Error('TOOL_ATTEMPT_NOT_FOUND');
      const snapshot = createAgentDocumentSnapshot(version.title, version.content);
      // insert 而非 upsert：预留 ID 若已被占用，不能覆盖一份现存文档。
      await manager.getRepository(Document).insert({ id: save.documentId, userId, title: version.title, content: version.content,
        folderId: save.folderId, isPublic: false, tags: [], deletedAt: null, deletedFromFolderId: null });
      await manager.query(`UPDATE documents SET "docTsv"=setweight(to_tsvector('simple',$2),'A') ||
        setweight(to_tsvector('simple',left($3,100000)),'D') WHERE id=$1 AND "userId"=$4`, [save.documentId, version.title, version.content, userId]);
      const update = await manager.getRepository(SyncUpdate).save({ docId: save.documentId, update: snapshot.snapshot, clientId: 'system', timestamp: Date.now() });
      await manager.getRepository(DocSnapshot).insert({ docId: save.documentId, snapshot: snapshot.snapshot, version: update.updateId,
        updateCount: 1, size: snapshot.size, createdAt: new Date() });
      const saved = await saves.update({ id: save.id, userId, status: 'PREPARED' }, { status: 'SAVED', savedCallId: callId, savedAt: () => 'clock_timestamp()' });
      if (saved.affected !== 1) throw new Error('AGENT_SAVE_COMMIT_CONFLICT');
      await calls.transition(userId, runId, callId, call.revision, { type: 'SUCCEEDED', sideEffect: 'committed' }, attempt.id);
      await manager.query(`INSERT INTO agent_tool_results ("attemptId",output,"errorCode","outputBytes") VALUES ($1,$2::jsonb,NULL,$3)`,
        [attempt.id, serialized, Buffer.byteLength(serialized, 'utf8')]);
      await manager.query(`INSERT INTO agent_budget_reservations ("attemptId",status,"executionKind","settledAt")
        VALUES ($1,'SETTLED','builtin_write_atomic',clock_timestamp())`, [attempt.id]);
      return output;
    });
  }
}
