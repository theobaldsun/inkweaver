/** 文档保存的准备入口：固定版本与目的地并预留唯一文档 ID；不创建文档、不代表用户已确认。 */
import { randomUUID } from 'node:crypto';

import { lockAgentOwner } from './agent-data.cleanup';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentDocumentSave } from './entity/agent-document-save.entity';
import { bindingDigest, inspectToolResources } from './tools/tool-resources';

import type { ToolResourceScope } from './tools/tool-resources';
import type { EntityManager } from 'typeorm';

export interface PrepareAgentDocumentSave {
  /** 逻辑保存键，同一 Run 的重试复用，不由模型随机生成。 */
  requestKey: string;
  /** 明确选定的草稿版本 UUID，不会自动切换为最新版。 */
  artifactVersionId: string;
  /** 目标文件夹 UUID；null 表示根目录。 */
  folderId: string | null;
}

/** 固定绑定复核结果；不含保存记录状态，也不能当作已保存证明。 */
export interface AgentDocumentSaveBinding {
  /** 已复核的草稿版本 UUID。 */
  artifactVersionId: string;
  /** 版本所属会话 UUID，取自当前 Run。 */
  threadId: string;
  /** artifactVersionId、版本内容摘要与 folderId 的 SHA-256；身份和来源权限另由归属查询复核。 */
  digest: string;
}

/** 归一化后的可信输入；UUID 统一小写，避免同值不同写法绕过既有绑定。 */
interface NormalizedSaveInput {
  requestKey: string;
  artifactVersionId: string;
  folderId: string | null;
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export class AgentDocumentSaveStore {
  constructor(private readonly manager: EntityManager) {}

  /**
   * 用户锁 → Run 锁 → 版本/目的地/来源校验 → 固定绑定。
   * 同键同参数复用；同键变更参数冲突。一个成果版本不能用新键或新 Run 再预留另一文档。
   * scope 来自可信服务端；实际执行前还须重新鉴权、检查确认、配额及文档转换。
   */
  async prepare(userId: string, runId: string, input: PrepareAgentDocumentSave, scope: ToolResourceScope): Promise<AgentDocumentSave> {
    const value = this.normalize(userId, runId, input);
    const permission = { allowOwnedLibrary: scope.allowOwnedLibrary, documentIds: [...scope.documentIds], folderIds: [...scope.folderIds] };
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      // 复核与执行阶段共用同一套绑定规则；准备只在此基础上多出记录写入。
      const binding = await this.resolveBinding(manager, userId, runId, value, permission);
      const repository = manager.getRepository(AgentDocumentSave);
      const existing = await repository.findOneBy({ userId, runId, requestKey: value.requestKey });
      if (existing) return existing;
      const id = randomUUID();
      await repository.insert({ requestKey: value.requestKey, artifactVersionId: value.artifactVersionId, folderId: value.folderId,
        id, userId, runId, threadId: binding.threadId, digest: binding.digest, documentId: randomUUID(), status: 'PREPARED', savedAt: null });
      return repository.findOneByOrFail({ id, userId });
    });
  }

  /**
   * 执行阶段的只读复核：确认版本、目的地与来源在提交时仍然有效。
   * 只读取并检查既有绑定，不写入、不预留文档 ID、不再开事务；调用方必须已在自己的事务内持有用户锁。
   * 复核通过不等于已保存；真正的文档写入仍由 AgentDocumentWriter 在同一事务完成。
   */
  async verify(userId: string, runId: string, input: PrepareAgentDocumentSave, scope: ToolResourceScope): Promise<AgentDocumentSaveBinding> {
    const value = this.normalize(userId, runId, input);
    const permission = { allowOwnedLibrary: scope.allowOwnedLibrary, documentIds: [...scope.documentIds], folderIds: [...scope.folderIds] };
    return this.resolveBinding(this.manager, userId, runId, value, permission);
  }

  /** 按可信用户归属读取保存绑定；PREPARED 记录不能用作已保存文档的证明。 */
  async get(userId: string, id: string): Promise<AgentDocumentSave | null> {
    if (!uuid.test(userId) || !uuid.test(id)) throw new Error('INVALID_AGENT_DOCUMENT_SAVE');
    return this.manager.getRepository(AgentDocumentSave).findOneBy({ id, userId });
  }

  /** 校验输入形状并归一化；不补默认值，不转换业务语义。 */
  private normalize(userId: string, runId: string, input: PrepareAgentDocumentSave): NormalizedSaveInput {
    if (!uuid.test(userId) || !uuid.test(runId) || !input || !uuid.test(input.artifactVersionId)
      || (input.folderId !== null && !uuid.test(input.folderId)) || typeof input.requestKey !== 'string'
      || !input.requestKey.trim() || [...input.requestKey.trim()].length > 128 || input.requestKey.includes('\0')) {
      throw new Error('INVALID_AGENT_DOCUMENT_SAVE');
    }
    return { requestKey: input.requestKey.trim(), artifactVersionId: input.artifactVersionId.toLowerCase(), folderId: input.folderId?.toLowerCase() ?? null };
  }

  /**
   * 版本、目的地、来源与既有绑定的一致复核；准备与执行阶段共用，避免规则漂移。
   * 只在调用方事务内执行，不自行提交；调用方先持用户锁，本方法再读取并锁定 Run。
   */
  private async resolveBinding(manager: EntityManager, userId: string, runId: string, value: NormalizedSaveInput,
    permission: ToolResourceScope): Promise<AgentDocumentSaveBinding> {
    const [run]: Array<{ threadId: string }> = await manager.query(`SELECT "threadId" FROM agent_runs
      WHERE id=$1 AND "userId"=$2 AND mode='task' AND status='RUNNING' AND "threadId" IS NOT NULL FOR UPDATE`, [runId, userId]);
    if (!run) throw new Error('AGENT_RUN_NOT_AVAILABLE');
    const version = await manager.getRepository(AgentArtifactVersion).findOneBy({ id: value.artifactVersionId, userId, threadId: run.threadId });
    if (!version || version.kind !== 'draft') throw new Error('AGENT_SAVE_VERSION_UNAVAILABLE');
    const digest = bindingDigest({ bindingVersion: 1, artifactVersionId: version.id, artifactDigest: version.digest, folderId: value.folderId });
    const repository = manager.getRepository(AgentDocumentSave);
    const existing = await repository.findOneBy({ userId, runId, requestKey: value.requestKey });
    if (existing && existing.digest !== digest) throw new Error('AGENT_SAVE_REQUEST_CONFLICT');
    const bound = await repository.findOneBy({ artifactVersionId: version.id, userId });
    if (bound && bound.id !== existing?.id) throw new Error('AGENT_SAVE_VERSION_ALREADY_BOUND');
    await inspectToolResources(manager, userId, [value.folderId
      ? { kind: 'folder', id: value.folderId, action: 'create' }
      : { kind: 'library', id: userId, action: 'create' }], permission);
    // 包括正文引用和证据报告引用；旧成果归属正确不代表其来源仍有访问权限。
    const sources: Array<{ docId: string }> = await manager.query(`SELECT s."docId" FROM agent_artifact_sources a
      JOIN agent_run_sources s ON s.id=a."sourceId" AND s."runId"=a."runId" AND s."userId"=a."userId"
      WHERE a."versionId"=$1 AND a."userId"=$2`, [version.id, userId]);
    await inspectToolResources(manager, userId, sources.map(({ docId }) => ({ kind: 'document', id: docId, action: 'read' })), permission);
    return { artifactVersionId: version.id, threadId: run.threadId, digest };
  }
}
