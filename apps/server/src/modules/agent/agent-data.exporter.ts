/** 用户 Agent 数据导出；只供已完成身份及密码核验的用户数据服务调用。 */
import { parseAgentEventBody } from './agent-event';

import type { EntityManager } from 'typeorm';

/** 导出各项均为按用户归属过滤的原始持久化记录；不存在的可选表返回空数组。 */
export interface AgentDataExport {
  /** 保存意图及最终文档映射，不包含文档正文之外的凭据。 */
  documentSaves: unknown[];
  /** 会话成果聚合根。 */
  artifacts: unknown[];
  /** 不可变成果版本及正文。 */
  artifactVersions: unknown[];
  /** 成果版本引用的运行来源标签。 */
  artifactSources: unknown[];
  /** 模型调用状态、耗时及 token 统计，不含 prompt/response。 */
  modelCalls: unknown[];
  /** Graph Checkpoint 与二进制 blob 的安全 JSON/base64 表示。 */
  checkpoints: unknown[];
  /** Run 检索来源及其内容快照。 */
  sources: unknown[];
  /** 会话及归档状态。 */
  threads: unknown[];
  /** 用户可见对话消息。 */
  messages: unknown[];
  /** 运行状态、工作流和修订目标。 */
  runs: unknown[];
  /** 经协议校验的领域事件历史。 */
  events: unknown[];
  /** 工具调用定义快照、输入和生命周期状态。 */
  toolCalls: unknown[];
  /** 每次执行尝试及其租约生命周期。 */
  toolAttempts: unknown[];
  /** 执行前确认及其绑定资源摘要。 */
  confirmations: unknown[];
  /** 工具结果；凭据不得存入结果载荷。 */
  toolResults: unknown[];
  /** 每次工具尝试的预算预留与结算状态。 */
  budgetReservations: unknown[];
}

/**
 * Run、事件与工具调用读取使用同一可重复读快照，避免查询之间提交变更造成不一致。
 * 兼容尚未应用 Agent 迁移的旧环境；存在的表查询失败必须报错，不吞掉数据库故障。
 * 当前沿用全量 JSON 导出形式；大规模异步导出及其他 Agent 表随对应功能追加。
 */
export async function exportAgentData(manager: EntityManager, userId: string): Promise<AgentDataExport> {
  return manager.transaction('REPEATABLE READ', async (transaction) => {
    const [tables] = await transaction.query(`SELECT to_regclass('agent_runs') IS NOT NULL AS runs,
      to_regclass('agent_events') IS NOT NULL AS events,
      to_regclass('agent_tool_calls') IS NOT NULL AS calls,
      to_regclass('agent_tool_attempts') IS NOT NULL AS attempts,
      to_regclass('agent_confirmations') IS NOT NULL AS confirmations,
      to_regclass('agent_tool_results') IS NOT NULL AS results,
      to_regclass('agent_budget_reservations') IS NOT NULL AS budgets,
      to_regclass('agent_threads') IS NOT NULL AS threads,
      to_regclass('agent_messages') IS NOT NULL AS messages,
      to_regclass('agent_run_sources') IS NOT NULL AS sources,
      to_regclass('agent_checkpoint.checkpoints') IS NOT NULL AS checkpoints,
      to_regclass('agent_model_calls') IS NOT NULL AS models,
      to_regclass('agent_artifacts') IS NOT NULL AS artifacts,
      to_regclass('agent_artifact_versions') IS NOT NULL AS "artifactVersions",
      to_regclass('agent_artifact_sources') IS NOT NULL AS "artifactSources",
      to_regclass('agent_document_saves') IS NOT NULL AS "documentSaves"`);
    if (!tables.runs) {
      if (tables.events || tables.calls || tables.attempts || tables.confirmations || tables.results || tables.budgets || tables.threads || tables.messages || tables.sources || tables.checkpoints || tables.models || tables.artifacts || tables.artifactVersions || tables.artifactSources || tables.documentSaves) throw new Error('INCOMPLETE_AGENT_SCHEMA');
      return { documentSaves: [], artifacts: [], artifactVersions: [], artifactSources: [], modelCalls: [], checkpoints: [], sources: [], threads: [], messages: [], runs: [], events: [], toolCalls: [], toolAttempts: [], confirmations: [], toolResults: [], budgetReservations: [] };
    }
    if ((tables.attempts || tables.confirmations) && !tables.calls) throw new Error('INCOMPLETE_AGENT_SCHEMA');
    if ((tables.results || tables.budgets) && !tables.attempts) throw new Error('INCOMPLETE_AGENT_SCHEMA');
    if (Boolean(tables.threads) !== Boolean(tables.messages)) throw new Error('INCOMPLETE_AGENT_SCHEMA');
    if (Boolean(tables.artifacts) !== Boolean(tables.artifactVersions) || Boolean(tables.artifacts) !== Boolean(tables.artifactSources)
      || (tables.artifacts && (!tables.threads || !tables.sources))) throw new Error('INCOMPLETE_AGENT_SCHEMA');
    if (tables.documentSaves && !tables.artifactVersions) throw new Error('INCOMPLETE_AGENT_SCHEMA');
    const threads: unknown[] = tables.threads ? await transaction.query(`SELECT id,"userId",title,"archivedAt","createdAt","updatedAt","lastActivityAt"
      FROM agent_threads WHERE "userId"=$1 ORDER BY "createdAt",id`, [userId]) : [];
    const messages: unknown[] = tables.messages ? await transaction.query(`SELECT m.id,m."threadId",m.role,m."contentVersion",m.content,m."requestKey",m."runId",m."createdAt"
      FROM agent_messages m JOIN agent_threads t ON t.id=m."threadId" AND t."userId"=m."userId"
      WHERE t."userId"=$1 ORDER BY m."threadId",m."createdAt",m.id`, [userId]) : [];
    // 会话迁移前后的 Run 均可导出；新结构额外包含触发消息关系。
    const runs: unknown[] = tables.threads
      ? await transaction.query(`SELECT id,"userId","threadId","triggerMessageId",mode,status,goal,"workflowVersion",
          revision,to_jsonb(agent_runs)->'revisionRange' AS "revisionRange",to_jsonb(agent_runs)->>'revisionArtifactId' AS "revisionArtifactId",
          (to_jsonb(agent_runs)->>'revisionBaseVersion')::integer AS "revisionBaseVersion","createdAt","updatedAt" FROM agent_runs WHERE "userId"=$1 ORDER BY "createdAt",id`, [userId])
      : await transaction.query(`SELECT id,"userId",mode,status,goal,"workflowVersion",
          revision,to_jsonb(agent_runs)->'revisionRange' AS "revisionRange",to_jsonb(agent_runs)->>'revisionArtifactId' AS "revisionArtifactId",
          (to_jsonb(agent_runs)->>'revisionBaseVersion')::integer AS "revisionBaseVersion","createdAt","updatedAt" FROM agent_runs WHERE "userId"=$1 ORDER BY "createdAt",id`, [userId]);
    // 参数快照是用户自己的数据；写入层必须禁止凭据入库，导出不补入适配器或连接配置。
    const toolCalls: unknown[] = tables.calls ? await transaction.query(`SELECT c.id, c."runId", c."callKey",
      c."toolName", c."toolVersion", c."originKind", c."connectionId", c.input,
      c.status, c."sideEffect", c."attemptCount", c."requiresConfirmation", c."cancelRequested",
      c.revision, c."createdAt", c."updatedAt"
      FROM agent_tool_calls c INNER JOIN agent_runs r ON r.id = c."runId" AND r."userId" = c."userId"
      WHERE r."userId" = $1 ORDER BY c."runId", c."createdAt", c.id`, [userId]) : [];
    const toolAttempts: unknown[] = tables.attempts ? await transaction.query(`SELECT a.id, a."callId", a."runId",
      a."attemptNumber", a."startRevision", a.status, a."startedAt", a."endedAt"
      FROM agent_tool_attempts a INNER JOIN agent_tool_calls c
        ON c.id = a."callId" AND c."runId" = a."runId" AND c."userId" = a."userId"
      WHERE c."userId" = $1 ORDER BY a."callId", a."attemptNumber"`, [userId]) : [];
    const confirmations: unknown[] = tables.confirmations ? await transaction.query(`SELECT id, "callId", "runId",
      "bindingVersion", digest, resources, status, "createdAt", "expiresAt", "resolvedAt"
      FROM agent_confirmations WHERE "userId" = $1 ORDER BY "createdAt", id`, [userId]) : [];
    const toolResults: unknown[] = tables.results ? await transaction.query(`SELECT t."attemptId", a."callId", a."runId",
      t.output,t."errorCode",t."outputBytes",t."createdAt" FROM agent_tool_results t
      JOIN agent_tool_attempts a ON a.id=t."attemptId" WHERE a."userId"=$1 ORDER BY t."createdAt",t."attemptId"`, [userId]) : [];
    const budgetReservations: unknown[] = tables.budgets ? await transaction.query(`SELECT b."attemptId",a."runId",b.status,b."createdAt",b."settledAt"
      FROM agent_budget_reservations b JOIN agent_tool_attempts a ON a.id=b."attemptId"
      WHERE a."userId"=$1 ORDER BY b."createdAt",b."attemptId"`, [userId]) : [];
    const sources: unknown[] = tables.sources ? await transaction.query(`SELECT s.id,s."runId",s."docId",
      s."retrievalKind",s.title,s.excerpt,to_jsonb(s)->>'citationLabel' AS "citationLabel",
      to_jsonb(s)->>'inheritedFromSourceId' AS "inheritedFromSourceId",to_jsonb(s)->>'toolCallId' AS "toolCallId",to_jsonb(s)->>'documentVersion' AS "documentVersion",s."documentUpdatedAt",s.score,s."usedInContext",s.cited,s."createdAt",s."updatedAt"
      FROM agent_run_sources s JOIN agent_runs r ON r.id=s."runId" AND r."userId"=s."userId"
      WHERE r."userId"=$1 ORDER BY s."runId",s."createdAt",s.id`, [userId]) : [];
    // 框架序列化数据属于用户数据，按 Run 归属导出；二进制使用 base64，不执行反序列化对象。
    const checkpoints: unknown[] = tables.checkpoints ? await transaction.query(`SELECT r.id AS "runId",
      (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM agent_checkpoint.checkpoints c WHERE c.thread_id=r."checkpointKey") AS checkpoints,
      (SELECT coalesce(jsonb_agg(to_jsonb(b) - 'blob' || jsonb_build_object('blobBase64',encode(b.blob,'base64'))), '[]'::jsonb)
        FROM agent_checkpoint.checkpoint_blobs b WHERE b.thread_id=r."checkpointKey") AS blobs,
      (SELECT coalesce(jsonb_agg(to_jsonb(w) - 'blob' || jsonb_build_object('blobBase64',encode(w.blob,'base64'))), '[]'::jsonb)
        FROM agent_checkpoint.checkpoint_writes w WHERE w.thread_id=r."checkpointKey") AS writes
      FROM agent_runs r WHERE r."userId"=$1 ORDER BY r."createdAt",r.id`, [userId]) : [];
    const modelCalls: unknown[] = tables.models ? await transaction.query(`SELECT m.id,m."runId",m.model,m.status,
      m."inputTokens",m."outputTokens",m."totalTokens",to_jsonb(m)->'reservedTokens' AS "reservedTokens",m."latencyMs",m."errorCode",m."createdAt",m."endedAt"
      FROM agent_model_calls m JOIN agent_runs r ON r.id=m."runId" AND r."userId"=m."userId"
      WHERE r."userId"=$1 ORDER BY m."createdAt",m.id`, [userId]) : [];
    const artifacts: unknown[] = tables.artifacts ? await transaction.query(`SELECT id,"threadId","createdAt"
      FROM agent_artifacts WHERE "userId"=$1 ORDER BY "createdAt",id`, [userId]) : [];
    const artifactVersions: unknown[] = tables.artifactVersions ? await transaction.query(`SELECT id,"artifactId","threadId","runId",version,kind,title,content,to_jsonb(agent_artifact_versions)->'evidence' AS evidence,digest,"createdAt"
      FROM agent_artifact_versions WHERE "userId"=$1 ORDER BY "artifactId",version`, [userId]) : [];
    const artifactSources: unknown[] = tables.artifactSources ? await transaction.query(`SELECT "versionId","sourceId","runId",label
      FROM agent_artifact_sources WHERE "userId"=$1 ORDER BY "versionId",label`, [userId]) : [];
    const documentSaves: unknown[] = tables.documentSaves ? await transaction.query(`SELECT id,"runId","threadId","artifactVersionId",
      "requestKey","documentId","folderId",digest,status,to_jsonb(agent_document_saves)->>'savedCallId' AS "savedCallId","createdAt","savedAt",to_jsonb(agent_document_saves)->'indexScheduledAt' AS "indexScheduledAt" FROM agent_document_saves
      WHERE "userId"=$1 ORDER BY "createdAt",id`, [userId]) : [];
    if (!tables.events) return { documentSaves, artifacts, artifactVersions, artifactSources, modelCalls, checkpoints, sources, threads, messages, runs, events: [], toolCalls, toolAttempts, confirmations, toolResults, budgetReservations };
    // DB 驱动返回的 JSON/枚举值先按 unknown 接收，必须经事件协议解析后才进入导出结果。
    const rows: { id: string; runId: string; sequence: number; createdAt: Date; schemaVersion: unknown; type: unknown; payload: unknown }[] =
      await transaction.query(`SELECT e.id, e."runId", e.sequence, e."createdAt", e."schemaVersion", e.type, e.payload
        FROM agent_events e INNER JOIN agent_runs r ON r.id = e."runId" AND r."userId" = e."userId"
        WHERE r."userId" = $1 ORDER BY e."runId", e.sequence`, [userId]);
    const events = rows.map((row) => ({ id: row.id, runId: row.runId, sequence: row.sequence, createdAt: row.createdAt,
      ...parseAgentEventBody({ schemaVersion: row.schemaVersion, type: row.type, payload: row.payload }) }));
    return { documentSaves, artifacts, artifactVersions, artifactSources, modelCalls, checkpoints, sources, threads, messages, runs, events, toolCalls, toolAttempts, confirmations, toolResults, budgetReservations };
  });
}
