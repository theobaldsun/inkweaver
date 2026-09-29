/**
 * 逻辑工具调用的纯状态模型；事件必须由可信执行/确认/恢复层在核验后产生。
 * 不验证授权、幂等键、租约或数据库竞争；状态迁移合法不等于事件事实已获证明。
 * 副作用表示整个逻辑调用的已知结果，不能仅凭最后一次尝试失败就抹去之前的写入。
 */
export type ToolCallStatus = 'PREPARED' | 'WAITING_CONFIRMATION' | 'READY' | 'EXECUTING'
  | 'RETRY_WAIT' | 'OUTCOME_UNKNOWN' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

/** 待持久化的生命周期值对象，不包含参数、确认令牌或执行函数。 */
export interface ToolCallLifecycle {
  /** 当前逻辑调用状态。 */
  status: ToolCallStatus;
  /** 当前已知的逻辑操作副作用；unknown 不可被当作未提交。 */
  sideEffect: 'none' | 'committed' | 'unknown';
  /** 已启动的尝试次数；领取成功才增加，不替代独立 attemptId/执行代次。 */
  attemptCount: number;
  /** 是否要求用户确认；等待确认后仍需执行前复核。 */
  requiresConfirmation: boolean;
  /** 取消意图，可能仍需等待正在进行的操作停止或对账。 */
  cancelRequested: boolean;
}

/** 事件描述已验证的事实，不接受模型或客户端直接指定。 */
export type ToolCallEvent =
  | { /** 资源权限及条件已通过。 */ type: 'RESOURCES_APPROVED' }
  | { /** 确认绑定、用户和有效期已验证。 */ type: 'CONFIRMED' }
  | { /** 当前权限、确认、预算与执行权已复核。 */ type: 'START' }
  | { /** 已取得合规成功结果。 */ type: 'SUCCEEDED'; /** 权威记录确认的整体副作用。 */ sideEffect: 'none' | 'committed' }
  | { /** 已确定失败且不再重试。 */ type: 'FAILED'; /** 已确认的整体副作用。 */ sideEffect: 'none' | 'committed' }
  | { /** 操作结果无法确定。 */ type: 'OUTCOME_UNKNOWN' }
  | { /** 已核验策略、剩余次数及旧尝试已结束或隔离。 */ type: 'RETRY_SCHEDULED'; /** 整体副作用状态。 */ sideEffect: 'none' | 'unknown'; /** 未知结果只允许已验证的幂等重放。 */ guarantee: 'safe' | 'idempotency-key' }
  | { /** 退避结束，返回等待执行前复核。 */ type: 'RETRY_DUE' }
  | { /** 用户拒绝或请求取消，不代表执行已停止。 */ type: 'CANCEL_REQUESTED' }
  | { /** 已确认旧尝试停止且整体没有写副作用。 */ type: 'STOPPED_WITHOUT_EFFECT' }
  | { /** 执行前调用或确认有效期届满。 */ type: 'EXPIRED' };

/** 非法迁移不修改原对象，不携带用户内容。 */
export class ToolCallTransitionError extends Error {
  /** 稳定错误码。 */
  readonly code = 'INVALID_TOOL_CALL_TRANSITION';
  constructor() {
    super('INVALID_TOOL_CALL_TRANSITION');
    this.name = 'ToolCallTransitionError';
  }
}

/** 创建初始生命周期值；本函数不表示调用记录已经落库。 */
export function createToolCallLifecycle(requiresConfirmation: boolean): ToolCallLifecycle {
  return { status: 'PREPARED', sideEffect: 'none', attemptCount: 0, requiresConfirmation, cancelRequested: false };
}

/** 判断是否终态；结果不明必须保留可对账状态，不属于终态。 */
export function isToolCallTerminal(status: ToolCallStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED';
}

/**
 * 返回新状态，不修改输入。终态拒绝所有事件，包括重复完成；持久化层负责事件去重。
 * START 记录新的尝试序号；重试期间保留整体副作用未知状态，不能靠取消/过期清空它。
 */
export function transitionToolCall(state: ToolCallLifecycle, event: ToolCallEvent): ToolCallLifecycle {
  if (isToolCallTerminal(state.status)) throw new ToolCallTransitionError();
  const next = { ...state };
  const active = state.status === 'EXECUTING' || state.status === 'OUTCOME_UNKNOWN';
  switch (event.type) {
    case 'RESOURCES_APPROVED':
      if (state.status !== 'PREPARED') break;
      next.status = state.requiresConfirmation ? 'WAITING_CONFIRMATION' : 'READY';
      return next;
    case 'CONFIRMED':
      if (state.status !== 'WAITING_CONFIRMATION') break;
      next.status = 'READY';
      return next;
    case 'START':
      if (state.status !== 'READY' || state.cancelRequested || !Number.isSafeInteger(state.attemptCount + 1)) break;
      return { ...next, status: 'EXECUTING', sideEffect: 'unknown', attemptCount: state.attemptCount + 1 };
    case 'SUCCEEDED':
      if (!active) break;
      return { ...next, status: 'SUCCEEDED', sideEffect: event.sideEffect };
    case 'FAILED':
      // 对账失败必须提供已知结果；执行前失败不得凭空声明副作用已提交。
      if (!active && (state.sideEffect !== 'none' || event.sideEffect !== 'none')) break;
      return { ...next, status: 'FAILED', sideEffect: event.sideEffect };
    case 'OUTCOME_UNKNOWN':
      if (state.status !== 'EXECUTING') break;
      return { ...next, status: 'OUTCOME_UNKNOWN', sideEffect: 'unknown' };
    case 'RETRY_SCHEDULED':
      if (!active || state.cancelRequested || (event.sideEffect === 'unknown' && event.guarantee !== 'idempotency-key')) break;
      return { ...next, status: 'RETRY_WAIT', sideEffect: event.sideEffect };
    case 'RETRY_DUE':
      if (state.status !== 'RETRY_WAIT' || state.cancelRequested) break;
      return { ...next, status: 'READY' };
    case 'CANCEL_REQUESTED':
      // 未知写结果必须继续对账；取消请求不等于操作被撤销。
      if (active || state.sideEffect === 'unknown') {
        return { ...next, status: state.sideEffect === 'unknown' && !active ? 'OUTCOME_UNKNOWN' : state.status, cancelRequested: true };
      }
      return { ...next, status: 'CANCELLED', cancelRequested: true };
    case 'STOPPED_WITHOUT_EFFECT':
      if (!active || !state.cancelRequested) break;
      return { ...next, status: 'CANCELLED', sideEffect: 'none' };
    case 'EXPIRED':
      if (active) break;
      // 幂等恢复等待期间若到期，仍须确认先前写入结果，不能标记“未执行”。
      if (state.sideEffect === 'unknown') return { ...next, status: 'OUTCOME_UNKNOWN', cancelRequested: true };
      return { ...next, status: 'EXPIRED' };
  }
  throw new ToolCallTransitionError();
}
