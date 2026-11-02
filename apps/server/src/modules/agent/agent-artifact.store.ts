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
   * 在同一事务内提交成果版本与引用映射。
   *
   * 核心机制：
   *   - 仅 RUNNING 且 mode='task' 的 Run 可写，且必须属于同一会话（threadId 一致）。
   *   - 幂等重放：同一成果 + 基准版本 + Run + 内容 → digest 相同 → 直接返回已存版本，不重复写入。
   *   - CAS 版本递增：expectedVersion + 1 必须等于当前最新版 +1，否则冲突（其他 Run 抢先发布）。
   *   - 来源权限每次复核：写入前重新 inspectToolResources，防止文档在生成后被删/撤销权限。
   *
   * @param input.expectedVersion 调用方看到的上一版本号；0 表示新建，最多到第 50 版。
   */
  async publish(userId: string, runId: string, input: PublishAgentArtifact, scope: ToolResourceScope): Promise<AgentArtifactVersion> {
    // 参数结构守卫：UUID 格式、版本范围、kind 白名单、标题/正文非空且长度合规、无 null 字符。
    if (!uuid.test(userId) || !uuid.test(runId) || !input || !uuid.test(input.artifactId)
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= 50
      || !['outline', 'draft'].includes(input.kind) || typeof input.title !== 'string'
      || !input.title.trim() || [...input.title.trim()].length > 200 || input.title.includes('\0')
      || typeof input.content !== 'string' || !input.content.trim() || input.content.includes('\0')
      || Buffer.byteLength(input.content, 'utf8') > 262144) throw new Error('INVALID_AGENT_ARTIFACT');
    // 校验成果正文（标题 + 正文）中所有 [S...] 引用标签的合法性：
    // ① 标签格式必须是 [S数字]（不能是 S0/S01/组合标签）② 每个标签必须在 input.citations 列表中存在映射
    // ③ binding 本身不超过 20 个，label 和 sourceId 不重复。
    // 返回实际被引用的 sourceId 列表（去重）；若校验失败直接抛 INVALID_AGENT_CITATION。
    const citedIds = validateAgentCitations(`${input.title}\n${input.content}`, input.citations);
    // 解析可选的证据报告（reviewEvidence 节点产出的结构化 JSON）。
    // 证据报告里提到的来源同样需要权限复核——不能只复核正文引用的来源，而漏掉证据里的来源。
    const evidence = input.evidence == null ? null : parseAgentEvidenceReport(input.evidence, input.citations);
    // 把证据报告里所有 issue 引用的来源标签展开，找到对应的 sourceId，加入 citedIds。
    // 这些来源可能在正文里没被直接引用，但证据报告提到了它们，同样需要确认访问权限。
    for (const label of evidence?.items.flatMap((item) => item.sourceLabels) ?? []) {
      const sourceId = input.citations.find((binding) => binding.label === label)!.sourceId;
      if (!citedIds.includes(sourceId)) citedIds.push(sourceId);
    }
    // 在第一次 await 前固定本次提交值，防止调用方在异步间隙修改参数。
    const value = { artifactId: input.artifactId, version: input.expectedVersion + 1, kind: input.kind,
      title: input.title.trim(), content: input.content };
    // 过滤出实际被引用的来源，按标签排序（消除顺序差异对 digest 的影响）。
    const citations = input.citations.filter((binding) => citedIds.includes(binding.sourceId))
      .map(({ label, sourceId }) => ({ label, sourceId })).sort((a, b) => a.label.localeCompare(b.label));
    // 权限快照：固定本次 scope，避免事务期间外部修改 scope 影响校验。
    const permission = { allowOwnedLibrary: scope.allowOwnedLibrary, documentIds: [...scope.documentIds], folderIds: [...scope.folderIds] };
    // 生成内容摘要：包含成果内容 + Run + 引用 + 证据，用于幂等重放判断。
    const digest = bindingDigest({ ...value, runId, citations, ...(evidence ? { evidence } : {}) });

    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      // 锁 Run 行并校验状态：必须 RUNNING + task 模式 + 有 threadId。
      const [run]: Array<Pick<AgentRun, 'threadId' | 'workflowVersion' | 'revisionArtifactId' | 'revisionBaseVersion' | 'revisionRange'>> = await manager.query(
        `SELECT "threadId","workflowVersion","revisionArtifactId","revisionBaseVersion","revisionRange" FROM agent_runs WHERE id=$1 AND "userId"=$2 AND status='RUNNING' AND mode='task' AND "threadId" IS NOT NULL FOR UPDATE`, [runId, userId]);
      if (!run?.threadId) throw new Error('AGENT_RUN_NOT_AVAILABLE');
      const artifacts = manager.getRepository(AgentArtifact);
      const versions = manager.getRepository(AgentArtifactVersion);

      // 章节修订模式：校验替换范围合法（不越界、不切代理对、不破坏引用）。
      if (run.workflowVersion === 'agent-section-v1') {
        // 章节修订只能出 draft，版本号必须是 baseVersion + 1，artifactId 必须匹配。
        if (!run.revisionRange || value.artifactId !== run.revisionArtifactId || value.version !== (run.revisionBaseVersion ?? 0) + 1
          || value.kind !== 'draft') throw new Error('INVALID_AGENT_REVISION_RANGE');
        const base = await versions.findOneBy({ artifactId: value.artifactId, version: run.revisionBaseVersion!, userId, threadId: run.threadId });
        // 章节替换不能改标题（只改指定范围内的正文）。
        if (!base || value.title !== base.title) throw new Error('AGENT_REVISION_OUTSIDE_RANGE');
        // 校验 replacement 只改 revisionRange 指定范围，不动范围外内容。
        assertRevisionBoundary(base.content, run.revisionRange, value.content);
      }

      // 查找成果父记录（artifact 表）：首版不存在则新建，存在则校验归属。
      const parent = await artifacts.findOneBy({ id: value.artifactId });
      if (parent && (parent.userId !== userId || parent.threadId !== run.threadId)) throw new Error('AGENT_ARTIFACT_NOT_AVAILABLE');

      // 幂等重放检测：同一 artifact + version + userId 是否已有记录。
      const replay = parent ? await versions.findOneBy({ artifactId: value.artifactId, version: value.version, userId }) : null;
      // 已有记录但 digest 不同 = 内容变了 → 冲突（不是真正的重放，不能覆盖）。
      if (replay && replay.digest !== digest) throw new Error('AGENT_ARTIFACT_VERSION_CONFLICT');

      // CAS 版本递增守卫：如果没有重放，当前最新版必须等于 expectedVersion（即 value.version - 1）。
      // 其他 Run 抢先发布了新版 → latest.version > expectedVersion → 冲突。
      const latest = parent ? await versions.findOne({ where: { artifactId: value.artifactId, userId }, order: { version: 'DESC' } }) : null;
      if (!replay && (latest?.version ?? 0) !== value.version - 1) throw new Error('AGENT_ARTIFACT_VERSION_CONFLICT');

      // 查当前 Run 上下文中实际被引用的来源（id + docId + citationLabel）。
      const sources: Array<{ id: string; docId: string; citationLabel: string }> = citations.length ? await manager.query(
        `SELECT id,"docId","citationLabel" FROM agent_run_sources WHERE "runId"=$1 AND "userId"=$2 AND "usedInContext"=true AND id=ANY($3::uuid[])`,
        [runId, userId, citations.map((binding) => binding.sourceId)]) : [];
      // 来源数量与引用数量必须一致；重放时沿用已冻结映射，新版本必须与当前 Run 上下文标签一致。
      if (sources.length !== citations.length || (!replay && citations.some((binding) =>
        !sources.some((source) => source.id === binding.sourceId && source.citationLabel === binding.label)))) throw new Error('INVALID_AGENT_CITATION');

      // 复核来源文档当前访问权限：生成期间文档可能被删或撤销权限。
      await inspectToolResources(manager, userId, sources.map((source) => ({ kind: 'document', id: source.docId, action: 'read' })), permission);

      // 幂等重放：直接返回已存版本，不重复写入。
      if (replay) return replay;

      // 首版创建：检查同一会话成果上限（最多 20 个）。
      if (!parent) {
        if (await artifacts.countBy({ userId, threadId: run.threadId }) >= 20) throw new Error('AGENT_ARTIFACT_LIMIT');
        await artifacts.insert({ id: value.artifactId, threadId: run.threadId, userId });
      }

      // 写入新版本记录。
      const id = randomUUID();
      await versions.insert({ ...value, evidence, id, runId, userId, threadId: run.threadId, digest });
      // 写入引用映射表（版本 → 来源）。
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
