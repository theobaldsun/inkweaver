import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentRunTransitionError, isAgentRunTerminal, transitionAgentRun } from './agent-run-lifecycle';

import type { AgentRunEvent, AgentRunStatus } from './agent-run-lifecycle';

test('确认后重新排队，不直接恢复执行', () => {
  let status: AgentRunStatus = 'CREATED';
  const steps = [
    ['ENQUEUE', 'QUEUED'], ['START', 'RUNNING'],
    ['WAIT_FOR_CONFIRMATION', 'WAITING_CONFIRMATION'], ['CONFIRMATION_ACCEPTED', 'QUEUED'],
    ['START', 'RUNNING'], ['COMPLETE', 'COMPLETED'],
  ] as const;
  for (const [type, expected] of steps) {
    status = transitionAgentRun(status, { type });
    assert.equal(status, expected);
  }
});

test('穷举状态与事件：只接受明确允许的转换，终态拒绝所有事件', () => {
  const statuses: AgentRunStatus[] = ['CREATED', 'QUEUED', 'RUNNING', 'WAITING_CONFIRMATION', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
  const targets: Record<AgentRunEvent['type'], Partial<Record<AgentRunStatus, AgentRunStatus>>> = {
    ENQUEUE: { CREATED: 'QUEUED' }, START: { QUEUED: 'RUNNING' },
    WAIT_FOR_CONFIRMATION: { RUNNING: 'WAITING_CONFIRMATION' },
    CONFIRMATION_ACCEPTED: { WAITING_CONFIRMATION: 'QUEUED' }, COMPLETE: { RUNNING: 'COMPLETED' },
    FAIL: { CREATED: 'FAILED', QUEUED: 'FAILED', RUNNING: 'FAILED', WAITING_CONFIRMATION: 'FAILED' },
    CANCEL_SETTLED: { CREATED: 'CANCELLED', QUEUED: 'CANCELLED', RUNNING: 'CANCELLED', WAITING_CONFIRMATION: 'CANCELLED' },
    TIMEOUT_SETTLED: { CREATED: 'TIMED_OUT', QUEUED: 'TIMED_OUT', RUNNING: 'TIMED_OUT', WAITING_CONFIRMATION: 'TIMED_OUT' },
  };
  for (const status of statuses) {
    assert.equal(isAgentRunTerminal(status), ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status));
    for (const type of Object.keys(targets) as AgentRunEvent['type'][]) {
      const expected = targets[type][status];
      if (expected) assert.equal(transitionAgentRun(status, { type }), expected);
      else assert.throws(() => transitionAgentRun(status, { type }), AgentRunTransitionError);
    }
  }
});

test('未知状态与原始取消请求不能绕过规则', () => {
  assert.throws(() => transitionAgentRun('INVALID' as AgentRunStatus, { type: 'FAIL' }), AgentRunTransitionError);
  assert.throws(() => transitionAgentRun('RUNNING', { type: 'CANCEL_REQUESTED' } as unknown as AgentRunEvent), AgentRunTransitionError);
});
