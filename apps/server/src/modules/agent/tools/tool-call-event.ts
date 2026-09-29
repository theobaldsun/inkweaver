/** 工具调用的持久化事实；不包含参数、输出、凭据或执行许可。 */
import { isDeepStrictEqual } from 'node:util';

import { createToolCallLifecycle, transitionToolCall } from './tool-call-lifecycle';

import type { ToolCallEvent, ToolCallLifecycle } from './tool-call-lifecycle';

export type ToolCallEventBody =
  | { schemaVersion: 1; type: 'TOOL_CALL_CREATED'; payload: {
    /** 本 Run 下的调用 UUID；归属由事务写入层保证。 */
    callId: string; revision: 0; state: ToolCallLifecycle;
  } }
  | { schemaVersion: 1; type: 'TOOL_CALL_STATE_CHANGED'; payload: {
    /** 调用修订号，区别于 Run 修订号及事件流序号。 */
    callId: string; revision: number;
    /** 保存前后生命周期，覆盖仅取消标记变化而状态不变的情况。 */
    from: ToolCallLifecycle; to: ToolCallLifecycle; cause: ToolCallEvent;
  } };

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function state(value: unknown): value is ToolCallLifecycle {
  return exact(value, ['status', 'sideEffect', 'attemptCount', 'requiresConfirmation', 'cancelRequested'])
    && typeof value.status === 'string'
    && ['PREPARED', 'WAITING_CONFIRMATION', 'READY', 'EXECUTING', 'RETRY_WAIT', 'OUTCOME_UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(value.status)
    && ['none', 'committed', 'unknown'].includes(value.sideEffect as string)
    && Number.isInteger(value.attemptCount) && (value.attemptCount as number) >= 0 && (value.attemptCount as number) <= 2147483647
    && typeof value.requiresConfirmation === 'boolean' && typeof value.cancelRequested === 'boolean';
}

function cause(value: unknown): value is ToolCallEvent {
  if (exact(value, ['type'])) {
    return ['RESOURCES_APPROVED', 'CONFIRMED', 'START', 'OUTCOME_UNKNOWN', 'RETRY_DUE', 'CANCEL_REQUESTED', 'STOPPED_WITHOUT_EFFECT', 'EXPIRED'].includes(value.type as string);
  }
  if (exact(value, ['type', 'sideEffect'])) {
    return ['SUCCEEDED', 'FAILED'].includes(value.type as string) && ['none', 'committed'].includes(value.sideEffect as string);
  }
  return exact(value, ['type', 'sideEffect', 'guarantee']) && value.type === 'RETRY_SCHEDULED'
    && ['none', 'unknown'].includes(value.sideEffect as string) && ['safe', 'idempotency-key'].includes(value.guarantee as string);
}

/** 仅由统一事件解析器调用；输入来自可信服务或 JSON.parse，非法正文返回 null。 */
export function parseToolCallEventBody(type: unknown, payload: unknown): ToolCallEventBody | null {
  if (!exact(payload, type === 'TOOL_CALL_CREATED' ? ['callId', 'revision', 'state'] : ['callId', 'revision', 'from', 'to', 'cause'])
    || typeof payload.callId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.callId)) return null;
  if (type === 'TOOL_CALL_CREATED' && exact(payload, ['callId', 'revision', 'state']) && payload.revision === 0
    && state(payload.state) && isDeepStrictEqual(payload.state, createToolCallLifecycle(payload.state.requiresConfirmation))) {
    return { schemaVersion: 1, type, payload: { callId: payload.callId as string, revision: 0, state: { ...payload.state } } };
  }
  if (type === 'TOOL_CALL_STATE_CHANGED' && exact(payload, ['callId', 'revision', 'from', 'to', 'cause'])
    && Number.isInteger(payload.revision) && (payload.revision as number) > 0 && (payload.revision as number) <= 2147483647
    && state(payload.from) && state(payload.to) && cause(payload.cause)) {
    try {
      if (isDeepStrictEqual(transitionToolCall(payload.from, payload.cause), payload.to)) {
        return { schemaVersion: 1, type, payload: { callId: payload.callId as string, revision: payload.revision as number,
          from: { ...payload.from }, to: { ...payload.to }, cause: { ...payload.cause } } };
      }
    } catch { return null; }
  }
  return null;
}
