import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolCallLifecycle, isToolCallTerminal, ToolCallTransitionError, transitionToolCall } from './tool-call-lifecycle';

import type { ToolCallEvent, ToolCallLifecycle } from './tool-call-lifecycle';

function executing(): ToolCallLifecycle {
  return transitionToolCall(transitionToolCall(createToolCallLifecycle(false), { type: 'RESOURCES_APPROVED' }), { type: 'START' });
}

test('只读流程成功，迁移不修改原对象，启动时才计数', () => {
  const initial = createToolCallLifecycle(false);
  const ready = transitionToolCall(initial, { type: 'RESOURCES_APPROVED' });
  assert.equal(initial.status, 'PREPARED');
  assert.equal(ready.attemptCount, 0);
  const started = transitionToolCall(ready, { type: 'START' });
  assert.equal(started.attemptCount, 1);
  const completed = transitionToolCall(started, { type: 'SUCCEEDED', sideEffect: 'none' });
  assert.equal(completed.status, 'SUCCEEDED');
  assert.equal(completed.sideEffect, 'none');
});

test('需要确认的调用不能跳过确认，也不能从 PREPARED 直接执行', () => {
  const initial = createToolCallLifecycle(true);
  assert.throws(() => transitionToolCall(initial, { type: 'START' }), ToolCallTransitionError);
  const waiting = transitionToolCall(initial, { type: 'RESOURCES_APPROVED' });
  assert.equal(waiting.status, 'WAITING_CONFIRMATION');
  assert.throws(() => transitionToolCall(waiting, { type: 'START' }), ToolCallTransitionError);
  assert.equal(transitionToolCall(waiting, { type: 'CONFIRMED' }).status, 'READY');
});

test('写入已提交但结果失败，保留 committed，不能重新执行', () => {
  const failed = transitionToolCall(executing(), { type: 'FAILED', sideEffect: 'committed' });
  assert.equal(failed.sideEffect, 'committed');
  assert.equal(failed.status, 'FAILED');
  assert.throws(() => transitionToolCall(failed, { type: 'START' }), ToolCallTransitionError);
});

test('所有终态拒绝后续事件，未知结果不是终态', () => {
  const events: ToolCallEvent[] = [{ type: 'START' }, { type: 'CANCEL_REQUESTED' }, { type: 'SUCCEEDED', sideEffect: 'none' }, { type: 'RETRY_SCHEDULED', sideEffect: 'none', guarantee: 'safe' }];
  for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) {
    assert.equal(isToolCallTerminal(status), true);
    for (const event of events) assert.throws(() => transitionToolCall({ ...createToolCallLifecycle(false), status }, event), ToolCallTransitionError);
  }
  assert.equal(isToolCallTerminal('OUTCOME_UNKNOWN'), false);
});

test('未知写结果不允许普通重试，幂等恢复保留未知且增加尝试序号', () => {
  const unknown = transitionToolCall(executing(), { type: 'OUTCOME_UNKNOWN' });
  assert.throws(() => transitionToolCall(unknown, { type: 'START' }), ToolCallTransitionError);
  assert.throws(() => transitionToolCall(unknown, { type: 'RETRY_SCHEDULED', sideEffect: 'unknown', guarantee: 'safe' }), ToolCallTransitionError);
  const retry = transitionToolCall(unknown, { type: 'RETRY_SCHEDULED', sideEffect: 'unknown', guarantee: 'idempotency-key' });
  assert.equal(retry.sideEffect, 'unknown');
  assert.throws(() => transitionToolCall(retry, { type: 'START' }), ToolCallTransitionError);
  const started = transitionToolCall(transitionToolCall(retry, { type: 'RETRY_DUE' }), { type: 'START' });
  assert.equal(started.attemptCount, 2);
});

test('执行中取消只记录意图，确认停止或查回成功后才能结束', () => {
  const cancelled = transitionToolCall(executing(), { type: 'CANCEL_REQUESTED' });
  assert.equal(cancelled.status, 'EXECUTING');
  assert.equal(cancelled.cancelRequested, true);
  assert.throws(() => transitionToolCall(cancelled, { type: 'RETRY_SCHEDULED', sideEffect: 'none', guarantee: 'safe' }), ToolCallTransitionError);
  assert.equal(transitionToolCall(cancelled, { type: 'STOPPED_WITHOUT_EFFECT' }).status, 'CANCELLED');
  assert.equal(transitionToolCall(cancelled, { type: 'SUCCEEDED', sideEffect: 'committed' }).status, 'SUCCEEDED');
});

test('等待重试时取消或过期不抹去此前未知结果', () => {
  const retry = transitionToolCall(executing(), { type: 'RETRY_SCHEDULED', sideEffect: 'unknown', guarantee: 'idempotency-key' });
  for (const type of ['CANCEL_REQUESTED', 'EXPIRED'] as const) {
    const pending = transitionToolCall(retry, { type });
    assert.equal(pending.status, 'OUTCOME_UNKNOWN');
    assert.equal(pending.sideEffect, 'unknown');
    assert.equal(pending.cancelRequested, true);
  }
});

test('执行前取消、到期和权限失败均可结束，但不能声明写入发生', () => {
  const initial = createToolCallLifecycle(true);
  assert.equal(transitionToolCall(initial, { type: 'CANCEL_REQUESTED' }).status, 'CANCELLED');
  assert.equal(transitionToolCall(initial, { type: 'EXPIRED' }).status, 'EXPIRED');
  assert.equal(transitionToolCall(initial, { type: 'FAILED', sideEffect: 'none' }).status, 'FAILED');
  assert.throws(() => transitionToolCall(initial, { type: 'FAILED', sideEffect: 'committed' }), ToolCallTransitionError);
  assert.throws(() => transitionToolCall(executing(), { type: 'EXPIRED' }), ToolCallTransitionError);
});
