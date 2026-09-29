import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentEventValidationError, parseAgentEventBody } from './agent-event';

const created = { schemaVersion: 1, type: 'RUN_CREATED', payload: { status: 'CREATED', revision: 0 } };
const changed = { schemaVersion: 1, type: 'RUN_STATUS_CHANGED', payload: { from: 'CREATED', to: 'QUEUED', cause: 'ENQUEUE', revision: 1 } };

test('接受创建和状态变化事件，返回独立快照', () => {
  for (const input of [created, changed]) {
    const result = parseAgentEventBody(input);
    assert.deepEqual(result, input);
    assert.notEqual(result, input);
    assert.notEqual(result.payload, input.payload);
  }
});

test('拒绝未知协议、类型、缺失及额外字段，不容纳私人正文', () => {
  for (const value of [null, [], {}, { ...created, schemaVersion: 2 }, { ...created, type: 'TOOL_RESULT' },
    { ...created, userId: 'injected' }, { ...created, payload: { ...created.payload, text: 'private' } },
    { ...created, payload: { status: 'CREATED' } }, { ...created, payload: { status: 'RUNNING', revision: 0 } },
    { ...created, payload: { status: 'CREATED', revision: 1 } }]) {
    assert.throws(() => parseAgentEventBody(value), { name: 'AgentEventValidationError', message: 'INVALID_AGENT_EVENT' });
  }
});

test('拒绝非法状态、原因、转换和修订号', () => {
  for (const patch of [{ from: 'INVALID' }, { to: 'INVALID' }, { cause: 'INVALID' },
    { to: 'RUNNING' }, { from: 'COMPLETED' }, { cause: 'START' },
    ...[0, -1, 0.5, NaN, Infinity, 2147483648, '1'].map((revision) => ({ revision }))]) {
    assert.throws(() => parseAgentEventBody({ ...changed, payload: { ...changed.payload, ...patch } }), AgentEventValidationError);
  }
});

test('确认后记录重新排队；取消结束与取消意图区分', () => {
  for (const payload of [
    { from: 'WAITING_CONFIRMATION', to: 'QUEUED', cause: 'CONFIRMATION_ACCEPTED', revision: 4 },
    { from: 'RUNNING', to: 'CANCELLED', cause: 'CANCEL_SETTLED', revision: 2147483647 },
  ]) assert.deepEqual(parseAgentEventBody({ ...changed, payload }).payload, payload);
  assert.throws(() => parseAgentEventBody({ ...changed, payload: { ...changed.payload, cause: 'CANCEL_REQUESTED' } }), AgentEventValidationError);
});
