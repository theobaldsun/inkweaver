/** 成果版本内部存储：用户锁协调清理与修订，Run 锁约束生命周期；没有模型调用或文档写入副作用。 */
import { randomUUID } from 'node:crypto';

import { validateAgentCitations } from './agent-citations';
import { lockAgentOwner } from './agent-data.cleanup';
import { parseAgentEvidenceReport } from './agent-evidence';
import { assertRevisionBoundary } from './agent-revision-range';
import { AgentArtifactSource } from './entity/agent-artifact-source.entity';
import { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import { AgentArtifact } from './entity/agent-artifact.entity';
import { bindingDigest, inspectToolResources } from './tools/tool-resources';

import type { AgentCitationBinding } from './agent-citations';
import type { AgentRun } from './entity/agent-run.entity';
import type { ToolResourceScope } from './tools/tool-resources';
import type { EntityManager } from 'typeorm';

export interface PublishAgentArtifact {
  /** 稳定成果 UUID；新建时由服务端生成，重试沿用，不接受模型生成的标识。 */
  artifactId: string;
  /** 调用方看到的上一版本号；0 表示新建，最多追加到第 50 版。 */
  expectedVersion: number;
  /** 提纲或草稿；不代表已保存为用户文档。 */
  kind: 'outline' | 'draft';
  /** 标题，去除两端空白后最多 200 个 Unicode 字符。 */
  title: string;
  /** Markdown 正文，上限 256 KiB（UTF-8），不接受空白正文。 */
  content: string;
  /** 来自服务端上下文的标签映射；保存正文/标题及证据问题引用的来源，最多 20 个。 */
  citations: readonly AgentCitationBinding[];
  /** 可选结构化证据问题；省略或 null 表示未分析，写入前仍须运行时校验。 */
  evidence?: unknown;
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export class AgentArtifactStore {
  constructor(private readonly manager: EntityManager) {}

  /**
   * 在同一事务提交成果、完整版本和引用。仅 RUNNING task Run 可写，且必须属于同一会话。
   * 同一成果、基准版本、Run 和内容的重放复用版本；内容变化或过时基准明确冲突。
   * userId、Run 及 scope 必须由服务端认证/授权层提供；每次复核当前来源权限。
   */
  async publish(userId: string, runId: string, input: PublishAgentArtifact, scope: ToolResourceScope): Promise<AgentArtifactVersion> {
    if (!uuid.test(userId) || !uuid.test(runId) || !input || !uuid.test(input.artifactId)
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= 50
      || !['outline', 'draft'].includes(input.kind) || typeof input.title !== 'string'
      || !input.title.trim() || [...input.title.trim()].length > 200 || input.title.includes('\0')
      || typeof input.content !== 'string' || !input.content.trim() || input.content.includes('\0')
      || Buffer.byteLength(input.content, 'utf8') > 262144) throw new Error('INVALID_AGENT_ARTIFACT');
    const citedIds = validateAgentCitations(`${input.title}\n${input.content}`, input.citations);
    const evidence = input.evidence == null ? null : parseAgentEvidenceReport(input.evidence, input.citations);
    for (const label of evidence?.items.flatMap((item) => item.sourceLabels) ?? []) {
      const sourceId = input.citations.find((binding) => binding.label === label)!.sourceId;
      if (!citedIds.includes(sourceId)) citedIds.push(sourceId);
    }
    // 在第一次 await 前固定本次提交值，调用方修改参数不改变事务内容。
    const value = { artifactId: input.artifactId, version: input.expectedVersion + 1, kind: input.kind,
      title: input.title.trim(), content: input.content };
    const citations = input.citations.filter((binding) => citedIds.includes(binding.sourceId))
      .map(({ label, sourceId }) => ({ label, sourceId })).sort((a, b) => a.label.localeCompare(b.label));
    const permission = { allowOwnedLibrary: scope.allowOwnedLibrary, documentIds: [...scope.documentIds], folderIds: [...scope.folderIds] };
    const digest = bindingDigest({ ...value, runId, citations, ...(evidence ? { evidence } : {}) });
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const [run]: Array<Pick<AgentRun, 'threadId' | 'workflowVersion' | 'revisionArtifactId' | 'revisionBaseVersion' | 'revisionRange'>> = await manager.query(
        `SELECT "threadId","workflowVersion","revisionArtifactId","revisionBaseVersion","revisionRange" FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' AND mode='task' AND "threadId" IS NOT NULL FOR UPDATE`, [runId, userId]);
      if (!run?.threadId) throw new Error('AGENT_RUN_NOT_AVAILABLE');
      const artifacts = manager.getRepository(AgentArtifact);
      const versions = manager.getRepository(AgentArtifactVersion);
      if (run.workflowVersion === 'agent-section-v1') {
        if (!run.revisionRange || value.artifactId !== run.revisionArtifactId || value.version !== (run.revisionBaseVersion ?? 0) + 1
          || value.kind !== 'draft') throw new Error('INVALID_AGENT_REVISION_RANGE');
        const base = await versions.findOneBy({ artifactId: value.artifactId, version: run.revisionBaseVersion!, userId, threadId: run.threadId });
        if (!base || value.title !== base.title) throw new Error('AGENT_REVISION_OUTSIDE_RANGE');
        assertRevisionBoundary(base.content, run.revisionRange, value.content);
      }
      const parent = await artifacts.findOneBy({ id: value.artifactId });
      if (parent && (parent.userId !== userId || parent.threadId !== run.threadId)) throw new Error('AGENT_ARTIFACT_NOT_AVAILABLE');
      const replay = parent ? await versions.findOneBy({ artifactId: value.artifactId, version: value.version, userId }) : null;
      if (replay && replay.digest !== digest) throw new Error('AGENT_ARTIFACT_VERSION_CONFLICT');
      const latest = parent ? await versions.findOne({ where: { artifactId: value.artifactId, userId }, order: { version: 'DESC' } }) : null;
      if (!replay && (latest?.version ?? 0) !== value.version - 1) throw new Error('AGENT_ARTIFACT_VERSION_CONFLICT');
      const sources: Array<{ id: string; docId: string; citationLabel: string }> = citations.length ? await manager.query(
        `SELECT id,"docId","citationLabel" FROM agent_run_sources WHERE "runId"=$1 AND "userId"=$2 AND "usedInContext"=true AND id=ANY($3::uuid[])`,
        [runId, userId, citations.map((binding) => binding.sourceId)]) : [];
      // 重放使用该版本已经冻结的映射；新版本必须与当前 Run 上下文标签一致。
      if (sources.length !== citations.length || (!replay && citations.some((binding) =>
        !sources.some((source) => source.id === binding.sourceId && source.citationLabel === binding.label)))) throw new Error('INVALID_AGENT_CITATION');
      await inspectToolResources(manager, userId, sources.map((source) => ({ kind: 'document', id: source.docId, action: 'read' })), permission);
      if (replay) return replay;
      if (!parent) {
        if (await artifacts.countBy({ userId, threadId: run.threadId }) >= 20) throw new Error('AGENT_ARTIFACT_LIMIT');
        await artifacts.insert({ id: value.artifactId, threadId: run.threadId, userId });
      }
      const id = randomUUID();
      await versions.insert({ ...value, evidence, id, runId, userId, threadId: run.threadId, digest });
      if (citations.length) await manager.getRepository(AgentArtifactSource).insert(citations.map((binding) => ({
        versionId: id, sourceId: binding.sourceId, label: binding.label, runId, userId,
      })));
      return versions.findOneByOrFail({ id, userId });
    });
  }

  /** 按可信用户归属读取指定版本和冻结引用；历史资料不自动授权给后续 Run 使用。 */
  async readVersion(userId: string, artifactId: string, version: number): Promise<{ version: AgentArtifactVersion; citations: AgentCitationBinding[] } | null> {
    if (!uuid.test(userId) || !uuid.test(artifactId) || !Number.isInteger(version) || version < 1 || version > 50) throw new Error('INVALID_AGENT_ARTIFACT');
    return this.manager.transaction('REPEATABLE READ', async (manager) => {
      const row = await manager.getRepository(AgentArtifactVersion).findOneBy({ artifactId, userId, version });
      if (!row) return null;
      const citations = await manager.getRepository(AgentArtifactSource).find({
        where: { versionId: row.id, userId }, select: { label: true, sourceId: true }, order: { label: 'ASC' },
      });
      return { version: row, citations };
    });
  }
}
