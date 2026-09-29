/**
 * 首版可持久化事件正文；区别于驱动领域状态转换的 AgentRunEvent。
 * 输入须来自可信服务或无 reviver 的 JSON.parse，不接受不可信进程内对象。
 * 仅校验格式和转换关系，不证明事件已发生、用户授权或数据库提交成功。
 */
import { transitionAgentRun } from './agent-run-lifecycle';
import { parseToolCallEventBody } from './tools/tool-call-event';

import type { AgentRunEvent, AgentRunStatus } from './agent-run-lifecycle';
import type { ToolCallEventBody } from './tools/tool-call-event';

export type AgentEventBody = ToolCallEventBody | {
  /** 首版协议；新增不兼容字段需显式版本迁移。 */
  schemaVersion: 1;
} & (
  | {
    /** Run 创建事实。 */
    type: 'RUN_CREATED';
    /** 不复制用户目标、工作流配置或私人正文。 */
    payload: { status: 'CREATED'; revision: 0 };
  }
  | {
    /** Run 状态已变化的事实。 */
    type: 'RUN_STATUS_CHANGED';
    /** 状态变化快照；revision 是更新后的 Run 修订号，不是事件流 sequence。 */
    payload: {
      /** 转换前状态。 */
      from: AgentRunStatus;
      /** 转换后状态，必须与领域状态机的转换结果一致。 */
      to: AgentRunStatus;
      /** 触发转换的领域事件类型。 */
      cause: AgentRunEvent['type'];
      /** 更新后的 Run 修订号，用于并发控制和快照对账。 */
      revision: number;
    };
  }
);

/** 拒绝时只返回稳定错误，不回显可能包含敏感内容的输入。 */
export class AgentEventValidationError extends Error {
  /** 固定机器码；不把非法载荷内容放入错误对象。 */
  readonly code = 'INVALID_AGENT_EVENT';
  constructor() {
    super('INVALID_AGENT_EVENT');
    this.name = 'AgentEventValidationError';
  }
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

const statuses: readonly string[] = ['CREATED', 'QUEUED', 'RUNNING', 'WAITING_CONFIRMATION', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
const causes: readonly string[] = ['ENQUEUE', 'START', 'WAIT_FOR_CONFIRMATION', 'CONFIRMATION_ACCEPTED', 'COMPLETE', 'FAIL', 'CANCEL_SETTLED', 'TIMEOUT_SETTLED'];

/**
 * 校验并返回独立正文快照；仅接受固定字段，因此没有任意文本或嵌套载荷入口。
 * 事件 ID、归属、序号与时间不属于正文，后续由可信事务写入层分配。
 */
export function parseAgentEventBody(value: unknown): AgentEventBody {
  if (!exact(value, ['schemaVersion', 'type', 'payload']) || value.schemaVersion !== 1) {
    throw new AgentEventValidationError();
  }
  const payload = value.payload;
  const toolEvent = parseToolCallEventBody(value.type, payload);
  if (toolEvent) return toolEvent;
  if (value.type === 'RUN_CREATED' && exact(payload, ['status', 'revision'])
    && payload.status === 'CREATED' && payload.revision === 0) {
    return { schemaVersion: 1, type: 'RUN_CREATED', payload: { status: 'CREATED', revision: 0 } };
  }
  if (value.type === 'RUN_STATUS_CHANGED' && exact(payload, ['from', 'to', 'cause', 'revision'])
    && typeof payload.from === 'string' && statuses.includes(payload.from)
    && typeof payload.to === 'string' && statuses.includes(payload.to)
    && typeof payload.cause === 'string' && causes.includes(payload.cause)
    && typeof payload.revision === 'number' && Number.isInteger(payload.revision)
    && payload.revision > 0 && payload.revision <= 2147483647) {
    const from = payload.from as AgentRunStatus;
    const to = payload.to as AgentRunStatus;
    const cause = payload.cause as AgentRunEvent['type'];
    // 复用领域模型，避免事件允许的转换与真实 Run 规则分叉。
    try {
      if (transitionAgentRun(from, { type: cause }) === to) {
        return { schemaVersion: 1, type: 'RUN_STATUS_CHANGED', payload: { from, to, cause, revision: payload.revision } };
      }
    } catch {
      throw new AgentEventValidationError();
    }
  }
  throw new AgentEventValidationError();
}
