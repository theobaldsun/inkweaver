/**
 * Agent 会话与可见消息的内部事实写入入口。
 * 用户请求消息、触发 Run 与 RUN_CREATED 事件同事务提交；请求键重复时只返回已提交事实，不重复创建 Run。
 */
import { createHash, randomUUID } from 'node:crypto';

import { parseAgentContentBlock } from '@inkweaver/shared';
import { QueryFailedError } from 'typeorm';

import { lockAgentOwner } from './agent-data.cleanup';
import { appendAgentEvent } from './agent-event.writer';
import { validateRevisionRange } from './agent-revision-range';
import { AgentRunStore } from './agent-run.store';
import { AgentMessage } from './entity/agent-message.entity';
import { AgentRun } from './entity/agent-run.entity';
import { AgentThread } from './entity/agent-thread.entity';

import type { AgentContentBlock } from '@inkweaver/shared';
import type { EntityManager } from 'typeorm';

/** 用户消息触发 Run 的固定输入；不接受客户端指定 ID、状态或用户归属。 */
export interface CreateAgentRequest {
  /** 所属 Thread UUID。 */
  threadId: string;
  /** 客户端为一次逻辑提交生成的去重键，同 Thread 内重试必须复用。 */
  requestKey: string;
  /** 首版只允许文本 ContentBlock；媒体能力后续按服务配置开放。 */
  content: unknown[];
  /** 对话或任务模式。 */
  mode: AgentRun['mode'];
  /** 创建时固定的工作流版本。 */
  workflowVersion: string;
  /** 可选修订目标；agent-revise-v1 与 agent-section-v1 接受，参与请求去重并同事务绑定 Run。 */
  revisionTarget?: {
    /** 用户选定的已有成果 UUID。 */
    artifactId: string;
    /** 用户看到的基准版本，1~49；过时版本不能静默覆盖新版。 */
    baseVersion: number;
    /** 可选章节范围，使用基准正文的 UTF-16 半开区间；仅 agent-section-v1 接受。 */
    range?: { start: number; end: number };
  };
}

/** 幂等创建结果；replayed=true 表示没有产生新的 Message/Run/Event。 */
export interface AgentRequestRecord {
  /** 已保存的用户消息。 */
  message: AgentMessage;
  /** 与该触发消息唯一绑定的 Run。 */
  run: AgentRun;
  /** 是否命中已提交的同键请求。 */
  replayed: boolean;
}

/** 会话层稳定错误，不回显用户正文或其他用户资源是否存在。 */
export class AgentConversationStoreError extends Error {
  /** 供 AgentApiErrorFilter 映射的稳定错误码。 */
  readonly code: 'INVALID_AGENT_CONVERSATION_INPUT' | 'THREAD_NOT_ACCEPTING_MESSAGES'
    | 'AGENT_REQUEST_KEY_CONFLICT' | 'AGENT_CONVERSATION_INCONSISTENT';

  constructor(code: AgentConversationStoreError['code']) {
    super(code);
    this.name = 'AgentConversationStoreError';
    this.code = code;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT_BLOCKS = 64;
const MAX_CONTENT_BYTES = 256 * 1024;
/** PostgreSQL 唯一约束冲突码；用于识别并发同键插入触发的幂等兜底。 */
const PG_UNIQUE_VIOLATION_CODE = '23505';

/** 严格解析当前消息内容；首版仅开放文本，拒绝静默删除未知字段。 */
function parseMessageContent(input: unknown): AgentContentBlock[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CONTENT_BLOCKS) {
    throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
  }
  const blocks = input.map((block) => {
    const parsed = parseAgentContentBlock(block);
    if (!parsed.ok) throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    return parsed.value;
  });
  if (Buffer.byteLength(JSON.stringify(blocks), 'utf8') > MAX_CONTENT_BYTES) {
    throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
  }
  return blocks;
}

/** Run goal 由触发消息的文本事实派生；首版不从隐藏上下文或模型补写目标。 */
function goalFrom(blocks: AgentContentBlock[]): string {
  const goal = blocks.filter((block): block is Extract<AgentContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text).join('\n').trim();
  if (!goal) throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
  return goal;
}

/** 对规范化后的可见请求求摘要，防止同 requestKey 被替换为不同正文或执行模式。 */
function requestDigest(blocks: AgentContentBlock[], mode: AgentRun['mode'], workflowVersion: string, revisionTarget?: CreateAgentRequest['revisionTarget']): string {
  return createHash('sha256').update(JSON.stringify({ contentVersion: 1, blocks, mode, workflowVersion, ...(revisionTarget ? { revisionTarget } : {}) }), 'utf8').digest('hex');
}

export class AgentConversationStore {
  /** 接受根 manager 或上层事务 manager；嵌套调用仍受最外层事务提交/回滚约束。 */
  constructor(private readonly manager: EntityManager) {}

  /** 创建空 Thread；标题为空时保持 null，由后续用户或产品逻辑命名。 */
  async createThread(userId: string, title?: string | null): Promise<AgentThread> {
    if (!uuid.test(userId) || (title !== undefined && title !== null
      && (typeof title !== 'string' || !title.trim() || [...title.trim()].length > 200))) {
      throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    }
    const normalizedTitle = title == null ? null : title.trim();
    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);
      const result = await manager.getRepository(AgentThread).createQueryBuilder().insert().into(AgentThread).values({
        id: randomUUID(), userId, title: normalizedTitle, archivedAt: null,
      }).returning('*').execute();
      return manager.getRepository(AgentThread).create(result.raw[0] as AgentThread);
    });
  }

  /**
   * 保存用户消息并创建唯一触发 Run。
   * 同 requestKey + 相同摘要返回既有记录；同 key 不同内容 fail closed，不能把重试解释成新请求。
   * 并发同键插入触发唯一约束时，捕获 23505 并回退为幂等重放，与串行命中等价。
   */
  async appendUserMessageAndCreateRun(userId: string, input: CreateAgentRequest): Promise<AgentRequestRecord> {
    if (!uuid.test(userId) || !input || !uuid.test(input.threadId)
      || typeof input.requestKey !== 'string' || !input.requestKey.trim() || [...input.requestKey.trim()].length > 128
      || !['dialogue', 'task'].includes(input.mode)
      || typeof input.workflowVersion !== 'string' || !input.workflowVersion.trim() || [...input.workflowVersion].length > 128) {
      throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    }
    const target = input.revisionTarget;
    if ((['agent-revise-v1', 'agent-section-v1'].includes(input.workflowVersion)) !== (target !== undefined)
      || (target !== undefined && (!target || input.mode !== 'task' || !uuid.test(target.artifactId)
        || !Number.isInteger(target.baseVersion) || target.baseVersion < 1 || target.baseVersion > 49))) {
      throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    }
    if ((input.workflowVersion === 'agent-section-v1') !== (target?.range !== undefined)
      || (target?.range !== undefined && (!target.range || !Number.isInteger(target.range.start) || !Number.isInteger(target.range.end)
        || target.range.start < 0 || target.range.end <= target.range.start || target.range.end > 262144))) {
      throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    }
    const revisionTarget = target ? { artifactId: target.artifactId.toLowerCase(), baseVersion: target.baseVersion, ...(target.range ? { range: { start: target.range.start, end: target.range.end } } : {}) } : undefined;
    const blocks = parseMessageContent(input.content);
    const goal = goalFrom(blocks);
    const key = input.requestKey.trim();
    const digest = requestDigest(blocks, input.mode, input.workflowVersion, revisionTarget);

    try {
      // 单事务内完成：校验线程 → 同键命中判定（串行幂等）→ 建消息+Run+事件 → 回填 runId。
      // 任何一步失败整体回滚，避免产生"有消息无 Run"或"有 Run 未绑定消息"的半截事实。
      return await this.manager.transaction('READ COMMITTED', async (manager) => {
        await lockAgentOwner(manager, userId);
        const thread = await manager.getRepository(AgentThread).findOneBy({ id: input.threadId, userId });
        if (!thread || thread.archivedAt) throw new AgentConversationStoreError('THREAD_NOT_ACCEPTING_MESSAGES');

        const messages = manager.getRepository(AgentMessage);
        // 串行幂等路径：先到达的事务已写入同 requestKey 消息，本次直接复用，不新建 Run。
        // 同键但摘要不同 → 视为"换了内容却复用了键"，fail-closed 拒绝，防止把重试解释成新请求。
        const existing = await messages.findOneBy({ userId, threadId: thread.id, requestKey: key });
        if (existing) {
          if (existing.requestDigest !== digest) throw new AgentConversationStoreError('AGENT_REQUEST_KEY_CONFLICT');
          const run = await manager.getRepository(AgentRun).findOneBy({ userId, threadId: thread.id, triggerMessageId: existing.id });
          if (!run || existing.runId !== run.id) throw new AgentConversationStoreError('AGENT_CONVERSATION_INCONSISTENT');
          return { message: existing, run, replayed: true };
        }

        // 修订类工作流：校验基准版本未被他人覆盖，并按需校验局部修订区间合法，再继续创建。
        if (revisionTarget) {
          const rows: Array<{ version: number; content: string }> = await manager.query(`SELECT version,content FROM agent_artifact_versions
            WHERE "artifactId"=$1 AND "threadId"=$2 AND "userId"=$3 ORDER BY version DESC LIMIT 1`,
          [revisionTarget.artifactId, thread.id, userId]);
          if (rows[0]?.version !== revisionTarget.baseVersion) throw new Error('AGENT_ARTIFACT_VERSION_CONFLICT');
          if (revisionTarget.range) validateRevisionRange(rows[0].content, revisionTarget.range);
        }
        // 原子创建触发消息（runId 暂留空）→ 创建唯一绑定的 Run → 写 RUN_CREATED 事件 → 回填 runId。
        // 消息先以 runId=null 插入，最后用"仅当仍为空"的条件 UPDATE 回填，确保触发消息与 Run 严格 1:1。
        const messageResult = await messages.createQueryBuilder().insert().into(AgentMessage).values({
          id: randomUUID(), threadId: thread.id, userId, role: 'user', contentVersion: 1,
          content: blocks, requestKey: key, requestDigest: digest, runId: null,
        }).returning('*').execute();
        const message = messages.create(messageResult.raw[0] as AgentMessage);
        const run = await new AgentRunStore(manager.getRepository(AgentRun)).create(userId, {
          mode: input.mode, goal, workflowVersion: input.workflowVersion,
          threadId: thread.id, triggerMessageId: message.id,
        });
        if (revisionTarget) {
          await manager.getRepository(AgentRun).update({ id: run.id, userId }, {
            revisionArtifactId: revisionTarget.artifactId, revisionBaseVersion: revisionTarget.baseVersion, revisionRange: revisionTarget.range ?? null,
          });
          run.revisionArtifactId = revisionTarget.artifactId;
          run.revisionBaseVersion = revisionTarget.baseVersion;
          run.revisionRange = revisionTarget.range ?? null;
        }
        await appendAgentEvent(manager, run, { schemaVersion: 1, type: 'RUN_CREATED', payload: { status: run.status, revision: run.revision } });
        // 回填 runId：条件里要求 runId IS NULL，受影响行数必须恰好为 1，否则说明并发已改写，直接判不一致。
        const linked = await messages.createQueryBuilder().update(AgentMessage).set({ runId: run.id })
          .where('id=:messageId AND "userId"=:userId AND "threadId"=:threadId AND "runId" IS NULL',
            { messageId: message.id, userId, threadId: thread.id }).returning('*').execute();
        if (linked.affected !== 1) throw new AgentConversationStoreError('AGENT_CONVERSATION_INCONSISTENT');
        await manager.query('UPDATE agent_threads SET "lastActivityAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE id=$1 AND "userId"=$2',
          [thread.id, userId]);
        return { message: messages.create(linked.raw[0] as AgentMessage), run, replayed: false };
      });
    } catch (error) {
      // 并发同键兜底：两个事务都通过 findOneBy 后才各自 insert，
      // 后到达者触发 UQ_agent_messages_request 唯一冲突。唯一索引已阻止重复 Run，
      // 此处回退为幂等重放，而非把冲突暴露成通用 409。
      if (error instanceof QueryFailedError
        && error.driverError?.code === PG_UNIQUE_VIOLATION_CODE
        && error.driverError?.constraint === 'UQ_agent_messages_request') {
        return this.replayExistingRequest(userId, input.threadId, key, digest);
      }
      throw error;
    }
  }

  /**
   * 并发同键冲突后的幂等回退：重查既有 message/run 并原样返回。
   *
   * 与串行路径的 existing 分支保持一致的 fail-closed 语义：
   * 同键不同摘要视为冲突，不把重试解释成重放；归档线程仍拒绝追加。
   * 仅在事务回滚后执行只读查询，不会写入任何新事实。
   */
  private async replayExistingRequest(userId: string, threadId: string, key: string, digest: string): Promise<AgentRequestRecord> {
    const thread = await this.manager.getRepository(AgentThread).findOneBy({ id: threadId, userId });
    if (!thread || thread.archivedAt) throw new AgentConversationStoreError('THREAD_NOT_ACCEPTING_MESSAGES');

    const messages = this.manager.getRepository(AgentMessage);
    const existing = await messages.findOneBy({ userId, threadId, requestKey: key });
    if (!existing) throw new AgentConversationStoreError('AGENT_CONVERSATION_INCONSISTENT');
    if (existing.requestDigest !== digest) throw new AgentConversationStoreError('AGENT_REQUEST_KEY_CONFLICT');

    const run = await this.manager.getRepository(AgentRun).findOneBy({ userId, threadId, triggerMessageId: existing.id });
    if (!run || existing.runId !== run.id) throw new AgentConversationStoreError('AGENT_CONVERSATION_INCONSISTENT');
    return { message: existing, run, replayed: true };
  }

  /**
   * 保存 Agent 的用户可见回复（assistant 消息）。
   *
   * 设计边界：
   * - 必须绑定同一用户、同一 Thread 的既有 Run；不绑定 Run 的消息会被拒绝。
   * - Thread 必须存在且未归档（archivedAt 为 null）。
   * - content 经过 parseMessageContent 校验：只接受 text 类型块，其他类型拒绝。
   * - 写入后更新 Thread 的 lastActivityAt，供会话列表排序。
   *
   * @param content 消息内容块数组，格式 [{ type: 'text', text: '...' }]。
   */
  async appendAssistantMessage(userId: string, threadId: string, runId: string, content: unknown[]): Promise<AgentMessage> {
    if (![userId, threadId, runId].every((id) => uuid.test(id))) {
      throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    }
    // 校验 content 结构：只接受 text 类型块，防注入/格式错误。
    const blocks = parseMessageContent(content);

    return this.manager.transaction('READ COMMITTED', async (manager) => {
      await lockAgentOwner(manager, userId);

      // 查 Thread 存在性 + 未归档；查 Run 存在性 + 归属正确。
      const thread = await manager.getRepository(AgentThread).findOneBy({ id: threadId, userId });
      const run = await manager.getRepository(AgentRun).findOneBy({ id: runId, threadId, userId });
      if (!thread || thread.archivedAt || !run) throw new AgentConversationStoreError('THREAD_NOT_ACCEPTING_MESSAGES');

      // 插入 assistant 消息：role='assistant'，绑定 runId，contentVersion=1。
      const repository = manager.getRepository(AgentMessage);
      const result = await repository.createQueryBuilder().insert().into(AgentMessage).values({
        id: randomUUID(), threadId, userId, role: 'assistant', contentVersion: 1, content: blocks,
        requestKey: null, requestDigest: null, runId,
      }).returning('*').execute();

      // 更新 Thread 活跃时间：供会话列表按最近活跃排序。
      await manager.query('UPDATE agent_threads SET "lastActivityAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE id=$1 AND "userId"=$2',
        [threadId, userId]);
      return repository.create(result.raw[0] as AgentMessage);
    });
  }

  /** 读取最多 100 条可见消息并按时间正序返回；查询始终绑定用户和 Thread，不返回隐藏执行数据。 */
  async listMessages(userId: string, threadId: string, limit = 100): Promise<AgentMessage[]> {
    if (!uuid.test(userId) || !uuid.test(threadId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AgentConversationStoreError('INVALID_AGENT_CONVERSATION_INPUT');
    }
    return this.manager.getRepository(AgentMessage).createQueryBuilder('message')
      .where('message."userId"=:userId AND message."threadId"=:threadId', { userId, threadId })
      .orderBy('message."createdAt"', 'ASC').addOrderBy('message.id', 'ASC').limit(limit).getMany();
  }
}
