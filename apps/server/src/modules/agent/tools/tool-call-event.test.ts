import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolCallLifecycle, transitionToolCall } from './tool-call-lifecycle';
import { parseAgentEventBody } from '../agent-event';

import type { ToolCallEvent } from './tool-call-lifecycle';

const callId = '11111111-1111-4111-8111-111111111111';

test('工具事实协议覆盖取消、确认、重试，快照不共享引用', () => {
  let from = createToolCallLifecycle(true);
  const created = { schemaVersion: 1, type: 'TOOL_CALL_CREATED', payload: { callId, revision: 0, state: from } };
  assert.deepEqual(parseAgentEventBody(created), created);
  let revision = 0;
  for (const cause of [
    { type: 'RESOURCES_APPROVED' }, { type: 'CONFIRMED' }, { type: 'START' },
    { type: 'RETRY_SCHEDULED', sideEffect: 'unknown', guarantee: 'idempotency-key' },
    { type: 'RETRY_DUE' }, { type: 'START' }, { type: 'CANCEL_REQUESTED' }, { type: 'SUCCEEDED', sideEffect: 'committed' },
  ] satisfies ToolCallEvent[]) {
    const to = transitionToolCall(from, cause);
    const value = { schemaVersion: 1, type: 'TOOL_CALL_STATE_CHANGED', payload: { callId, revision: ++revision, from, to, cause } };
    const parsed = parseAgentEventBody(value);
    assert.deepEqual(parsed, value);
    if (parsed.type === 'TOOL_CALL_STATE_CHANGED') {
      assert.notEqual(parsed.payload.from, from);
      assert.notEqual(parsed.payload.to, to);
      assert.notEqual(parsed.payload.cause, cause);
    }
    from = to;
  }
});

test('拒绝伪造转换、非法修订号、额外载荷与不合法原因组合', () => {
  const from = createToolCallLifecycle(false);
  const cause = { type: 'RESOURCES_APPROVED' } as const;
  const to = transitionToolCall(from, cause);
  const payload = { callId, revision: 1, from, to, cause };
  for (const change of [
    { callId: 'bad' }, { revision: 0 }, { revision: 1.5 }, { revision: 2147483648 },
    { to: { ...to, status: 'SUCCEEDED' } }, { to: { ...to, requiresConfirmation: true } },
    { from: { ...from, attemptCount: -1 } }, { to: { ...to, input: 'private' } },
    { cause: { type: 'SUCCEEDED', sideEffect: 'unknown' } }, { cause: { ...cause, token: 'private' } },
    { input: 'private' },
  ]) assert.throws(() => parseAgentEventBody({ schemaVersion: 1, type: 'TOOL_CALL_STATE_CHANGED', payload: { ...payload, ...change } }), /INVALID_AGENT_EVENT/);
  assert.throws(() => parseAgentEventBody({ schemaVersion: 1, type: 'TOOL_CALL_CREATED',
    payload: { callId, revision: 0, state: to } }), /INVALID_AGENT_EVENT/);
});
