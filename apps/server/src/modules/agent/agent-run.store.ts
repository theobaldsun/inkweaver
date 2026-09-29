/**
 * agent_runs 的内部访问入口；所有读取和更新都绑定可信用户身份。
 * 由调用方注入 Repository，可使用事务内 Repository 与后续调用记录共同提交。
 * 不单独注册 API；会话创建和 Run Writer 负责组合用户锁、事件及上层业务事务。
 */
import { randomUUID } from 'node:crypto';

import { transitionAgentRun } from './agent-run-lifecycle';
import { AgentRun } from './entity/agent-run.entity';

import type { AgentRunEvent, AgentRunStatus } from './agent-run-lifecycle';
import type { Repository } from 'typeorm';

export interface CreateAgentRun {
  /** 由上层选择的对话/任务模式。 */
  mode: AgentRun['mode'];
  /** 非空目标正文，保留原文。 */
  goal: string;
  /** 非空工作流版本，最多 128 个 Unicode 字符。 */
  workflowVersion: string;
  /** 可选连续会话 UUID；与 triggerMessageId 必须同时提供。 */
  threadId?: string;
  /** 可选触发消息 UUID；用于恢复和请求去重定位事实来源。 */
  triggerMessageId?: string;
}

export interface AgentRunExpectedState {
  /** 调用方读取到的旧状态。 */
  status: AgentRunStatus;
  /** 对应旧状态的修订号。 */
  revision: number;
}

/** 可映射的内部错误；不暴露目标正文或其他用户任务是否存在。 */
export class AgentRunStoreError extends Error {
  /** 参数错误，或未匹配归属/旧状态/修订号；后者统一表示无法提交。 */
  readonly code: 'INVALID_AGENT_RUN_INPUT' | 'AGENT_RUN_UPDATE_CONFLICT';

  constructor(code: AgentRunStoreError['code']) {
    super(code);
    this.name = 'AgentRunStoreError';
    this.code = code;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID 只校验格式；用户身份真实性仍由上层认证提供。 */
function checkIds(...ids: string[]): void {
  if (ids.some((id) => typeof id !== 'string' || !uuid.test(id))) {
    throw new AgentRunStoreError('INVALID_AGENT_RUN_INPUT');
  }
}

export class AgentRunStore {
  /** 可由事务作用域提供的 Run Repository，不在本类中打开连接。 */
  private readonly runs: Repository<AgentRun>;

  constructor(runs: Repository<AgentRun>) {
    this.runs = runs;
  }

  /** 创建新 Run；只接收创建字段，不允许指定初始状态、修订号或复用 ID。 */
  async create(userId: string, input: CreateAgentRun): Promise<AgentRun> {
    checkIds(userId);
    if (!input || !['dialogue', 'task'].includes(input.mode)
      || typeof input.goal !== 'string' || !input.goal.trim()
      || typeof input.workflowVersion !== 'string' || !input.workflowVersion.trim()
      || [...input.workflowVersion].length > 128
      || ((input.threadId === undefined) !== (input.triggerMessageId === undefined))) {
      throw new AgentRunStoreError('INVALID_AGENT_RUN_INPUT');
    }
    if (input.threadId !== undefined && input.triggerMessageId !== undefined) checkIds(input.threadId, input.triggerMessageId);
    const base = { id: randomUUID(), userId, mode: input.mode, goal: input.goal,
      workflowVersion: input.workflowVersion, status: 'CREATED' as const, revision: 0 };
    // 旧环境尚未应用会话迁移时，独立 Run 不引用新增列；会话 Run 才要求新迁移已存在。
    const result = input.threadId === undefined
      ? await this.runs.createQueryBuilder().insert().into(AgentRun,
        ['id', 'userId', 'mode', 'goal', 'workflowVersion', 'status', 'revision']).values(base).returning('*').execute()
      : await this.runs.createQueryBuilder().insert().into(AgentRun,
        ['id', 'userId', 'threadId', 'triggerMessageId', 'mode', 'goal', 'workflowVersion', 'status', 'revision']).values({
        ...base, threadId: input.threadId, triggerMessageId: input.triggerMessageId,
      }).returning('*').execute();
    return this.runs.create(result.raw[0] as AgentRun);
  }

  /** 不存在和不属于当前用户都返回 null，不提供跨用户存在性查询。 */
  async get(userId: string, runId: string): Promise<AgentRun | null> {
    checkIds(userId, runId);
    return this.runs.findOneBy({ id: runId, userId });
  }

  /**
   * 先计算合法目标状态，再以一次 UPDATE 原子比较并更新；不采用先查再 save。
   * 事件必须已由上层核验。冲突不自动重试，否则可能用新版本执行旧意图。
   */
  async transition(userId: string, runId: string, expected: AgentRunExpectedState, event: AgentRunEvent): Promise<AgentRun> {
    checkIds(userId, runId);
    // PostgreSQL integer 上限；提前拒绝溢出，避免事务被数据库错误中止。
    if (!Number.isInteger(expected.revision) || expected.revision < 0 || expected.revision >= 2147483647) {
      throw new AgentRunStoreError('INVALID_AGENT_RUN_INPUT');
    }
    const status = transitionAgentRun(expected.status, event);
    const result = await this.runs.createQueryBuilder().update(AgentRun).set({
      status, revision: () => '"revision" + 1', updatedAt: () => 'clock_timestamp()',
    }).where('"id" = :runId AND "userId" = :userId AND "status" = :status AND "revision" = :revision', {
      runId, userId, status: expected.status, revision: expected.revision,
    }).returning('*').execute();
    if (result.affected !== 1) throw new AgentRunStoreError('AGENT_RUN_UPDATE_CONFLICT');
    return this.runs.create(result.raw[0] as AgentRun);
  }
}
