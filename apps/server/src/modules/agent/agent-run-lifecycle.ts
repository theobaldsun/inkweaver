/**
 * Run 的纯状态规则，与 agent_runs.status 对齐；具体工作流步骤另由编排层管理。
 * 事件由可信应用服务核验后产生，不接受客户端直接指定；本模块不执行工具或写数据库。
 */
export type AgentRunStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'WAITING_CONFIRMATION'
  | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

/** 事件表示已核验事实；等待期间恢复执行也必须重新取得执行权并复核权限。 */
export type AgentRunEvent =
  | { /** 已具备调度条件。 */ type: 'ENQUEUE' }
  | { /** 已领取执行权并通过执行前检查。 */ type: 'START' }
  | { /** 已保存确认请求，当前执行步骤已暂停。 */ type: 'WAIT_FOR_CONFIRMATION' }
  | { /** 确认已验证，重新排队等待执行前检查。 */ type: 'CONFIRMATION_ACCEPTED' }
  | { /** 所有必需步骤完成，结果可用且无待处理调用。 */ type: 'COMPLETE' }
  | { /** 已确定失败并停止调度；没有仍在执行或结果未知的调用。 */ type: 'FAIL' }
  | { /** 已停止调度及执行，已处理在途调用；不代表撤销已提交成果。 */ type: 'CANCEL_SETTLED' }
  | { /** 时限已到且已停止执行、处理在途调用；单纯计时器触发不足以产生此事件。 */ type: 'TIMEOUT_SETTLED' };

/** 非法状态转换的稳定错误，不包含任务内容。 */
export class AgentRunTransitionError extends Error {
  /** 用于应用层错误映射。 */
  readonly code = 'INVALID_AGENT_RUN_TRANSITION';

  constructor() {
    super('INVALID_AGENT_RUN_TRANSITION');
    this.name = 'AgentRunTransitionError';
  }
}

/** 判断 Run 是否已经结束；终态不接受重复完成或恢复事件。 */
export function isAgentRunTerminal(status: AgentRunStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT';
}

/**
 * 计算目标状态；持久化层仍须用用户归属、旧状态及 revision 条件原子提交。
 * 本函数不证明事件事实，也不处理取消意图、调用对账、重复事件去重或崩溃恢复。
 */
export function transitionAgentRun(status: AgentRunStatus, event: AgentRunEvent): AgentRunStatus {
  if (isAgentRunTerminal(status)) throw new AgentRunTransitionError();
  switch (event.type) {
    case 'ENQUEUE':
      if (status === 'CREATED') return 'QUEUED';
      break;
    case 'START':
      if (status === 'QUEUED') return 'RUNNING';
      break;
    case 'WAIT_FOR_CONFIRMATION':
      if (status === 'RUNNING') return 'WAITING_CONFIRMATION';
      break;
    case 'CONFIRMATION_ACCEPTED':
      if (status === 'WAITING_CONFIRMATION') return 'QUEUED';
      break;
    case 'COMPLETE':
      if (status === 'RUNNING') return 'COMPLETED';
      break;
    case 'FAIL':
    case 'CANCEL_SETTLED':
    case 'TIMEOUT_SETTLED':
      // 明确列出非终态，运行时未知状态不能意外被“结束”为合法状态。
      if (status === 'CREATED' || status === 'QUEUED' || status === 'RUNNING' || status === 'WAITING_CONFIRMATION') {
        return event.type === 'FAIL' ? 'FAILED' : event.type === 'CANCEL_SETTLED' ? 'CANCELLED' : 'TIMED_OUT';
      }
  }
  throw new AgentRunTransitionError();
}
