/**
 * Agent 只读查询层：会话列表、会话明细与运行快照。
 * 所有语句都带用户归属，客户端不能指定 owner；本层不推进状态、不做确认裁决、不写事件。
 * 控制器只保留鉴权、参数校验与流式订阅编排，SQL 与实体查询集中在此处维护。
 */
import { AgentRun } from './entity/agent-run.entity';
import { AgentThread } from './entity/agent-thread.entity';

import type { AgentArtifactVersion } from './entity/agent-artifact-version.entity';
import type { AgentDocumentSave } from './entity/agent-document-save.entity';
import type { AgentMessage } from './entity/agent-message.entity';
import type { AgentModelCall } from './entity/agent-model-call.entity';
import type { AgentRunSource } from './entity/agent-run-source.entity';
import type { AgentConfirmation } from './tools/tool-authorization';
import type { EntityManager } from 'typeorm';

/**
 * 行类型一律从实体/领域契约投影，不手写重复字段：
 * 可空列（如 evidence、runId、latencyMs）与枚举列由持久化契约单点定义，避免查询类型与表结构漂移。
 */

/** 运行来源引用；返回受限片段与可空标签，不返回完整来源文档。 */
export type AgentRunSourceRow = Pick<AgentRunSource, 'id' | 'docId' | 'title' | 'excerpt' | 'citationLabel' | 'cited'>;

/** 已持久化的成果版本；evidence 为 null 表示尚未分析，不含隐藏推理。 */
export type AgentRunArtifactRow = Pick<AgentArtifactVersion,
  'id' | 'artifactId' | 'version' | 'kind' | 'title' | 'content' | 'evidence' | 'createdAt'>;

/** 确认记录（包括已处理记录）；resources 为展示/校验用快照，不含正文。 */
export type AgentRunConfirmationRow = Pick<AgentConfirmation, 'id' | 'callId' | 'status' | 'resources' | 'expiresAt'>;

/** 保存绑定与其成果正文；PREPARED 记录不能当作已保存文档。 */
export type AgentRunSaveRow = Pick<AgentDocumentSave, 'id' | 'status' | 'documentId' | 'folderId' | 'artifactVersionId'>
  & Pick<AgentArtifactVersion, 'title' | 'content'>;

/** 会话消息；runId 可空，用户消息与 Agent 回复都可能出现。 */
export type AgentRunMessageRow = Pick<AgentMessage, 'id' | 'role' | 'content' | 'runId' | 'createdAt'>;

/** 模型调用审计摘要；不含供应商原始报文。 */
// 从实体投影字段，保留未知用量的 null 语义，避免查询类型与持久化契约漂移。
export type AgentRunModelCallRow = Pick<AgentModelCall,
  'id' | 'model' | 'status' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'reservedTokens' | 'latencyMs'>;

/** 运行快照：刷新/重连后重建界面所需的事实，不替代事件流。 */
export interface AgentRunSnapshot {
  /** 运行记录，已按用户归属校验。 */
  run: AgentRun;
  /** 本次运行的来源引用。 */
  sources: AgentRunSourceRow[];
  /** 已发布的成果版本。 */
  artifacts: AgentRunArtifactRow[];
  /** 本 Run 的全部确认记录，页面按 status 筛出待处理项。 */
  confirmations: AgentRunConfirmationRow[];
  /** 保存绑定与成果正文。 */
  saves: AgentRunSaveRow[];
  /** 模型调用审计。 */
  modelCalls: AgentRunModelCallRow[];
}

/** 会话明细：会话记录、最近消息与该会话的运行列表。 */
export interface AgentThreadDetail {
  /** 会话记录，已按用户归属校验。 */
  thread: AgentThread;
  /** 按时间升序返回的最近 100 条消息。 */
  messages: AgentRunMessageRow[];
  /** 该会话最近 100 个运行。 */
  runs: AgentRun[];
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** 只读查询入口；由已初始化的数据源 manager 构造，不自行开启连接或事务。 */
export class AgentRunReader {
  constructor(private readonly manager: EntityManager) {}

  /** 会话列表按最近活跃倒序；首版最多返回 100 个。 */
  async listThreads(userId: string, limit = 100): Promise<AgentThread[]> {
    return this.manager.getRepository(AgentThread).find({ where: { userId }, order: { lastActivityAt: 'DESC', id: 'DESC' }, take: limit });
  }

  /** 会话最近消息和运行列表；查询都带用户归属，不存在即报错。 */
  async threadDetail(userId: string, threadId: string): Promise<AgentThreadDetail> {
    if (!uuid.test(userId) || !uuid.test(threadId)) throw new Error('INVALID_AGENT_THREAD_QUERY');
    const thread = await this.manager.getRepository(AgentThread).findOneByOrFail({ id: threadId, userId });
    const messages: AgentRunMessageRow[] = await this.manager.query(`SELECT id,role,content,"runId","createdAt" FROM agent_messages
      WHERE "userId"=$1 AND "threadId"=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 100`, [userId, threadId]);
    const runs = await this.manager.getRepository(AgentRun).find({ where: { userId, threadId }, order: { createdAt: 'DESC' }, take: 100 });
    return { thread, messages: messages.reverse(), runs };
  }

  /**
   * 运行快照用于刷新/重连；包含已持久化成果、来源与待确认请求，不包含隐藏推理。
   * 多条查询未包在 REPEATABLE READ 事务中，可能观察到不同提交时点，并非原子数据库快照。
   * 页面通过事件及心跳触发重新读取以收敛；需要一致导出时使用 exportAgentData。
   */
  async snapshot(userId: string, runId: string): Promise<AgentRunSnapshot> {
    if (!uuid.test(userId) || !uuid.test(runId)) throw new Error('INVALID_AGENT_RUN_QUERY');
    const run = await this.ownedRun(userId, runId);
    const [sources, artifacts, confirmations, saves, modelCalls] = await Promise.all([
      this.manager.query('SELECT id,"docId",title,excerpt,"citationLabel",cited FROM agent_run_sources WHERE "runId"=$1 AND "userId"=$2 ORDER BY "citationLabel"', [runId, userId]) as Promise<AgentRunSourceRow[]>,
      this.manager.query('SELECT id,"artifactId",version,kind,title,content,evidence,"createdAt" FROM agent_artifact_versions WHERE "runId"=$1 AND "userId"=$2 ORDER BY version', [runId, userId]) as Promise<AgentRunArtifactRow[]>,
      this.manager.query('SELECT id,"callId",status,resources,"expiresAt" FROM agent_confirmations WHERE "runId"=$1 AND "userId"=$2 ORDER BY "createdAt"', [runId, userId]) as Promise<AgentRunConfirmationRow[]>,
      this.manager.query('SELECT s.id,s.status,s."documentId",s."folderId",s."artifactVersionId",v.title,v.content FROM agent_document_saves s JOIN agent_artifact_versions v ON v.id=s."artifactVersionId" AND v."userId"=s."userId" WHERE s."runId"=$1 AND s."userId"=$2', [runId, userId]) as Promise<AgentRunSaveRow[]>,
      this.manager.query('SELECT id,model,status,"inputTokens","outputTokens","totalTokens","reservedTokens","latencyMs" FROM agent_model_calls WHERE "runId"=$1 AND "userId"=$2 ORDER BY "createdAt"', [runId, userId]) as Promise<AgentRunModelCallRow[]>,
    ]);
    return { run, sources, artifacts, confirmations, saves, modelCalls };
  }

  /** 只用于确认用户拥有该运行；不存在或不属于该用户时抛出实体查找错误。 */
  async ownedRun(userId: string, runId: string): Promise<AgentRun> {
    return this.manager.getRepository(AgentRun).findOneByOrFail({ id: runId, userId });
  }
}
