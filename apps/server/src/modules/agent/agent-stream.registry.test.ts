import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentStreamRegistry } from './agent-stream.registry';

const u1 = '11111111-1111-4111-8111-111111111111';
const u2 = '22222222-2222-4222-8222-222222222222';

test('申请成功即占用槽位，并交还一个归还函数', () => {
  const registry = new AgentStreamRegistry();
  const release = registry.acquire(u1);
  assert.equal(typeof release, 'function');
  assert.equal(registry.count(u1), 1);
  assert.equal(registry.acquire(u1) !== null, true);
  assert.equal(registry.count(u1), 2);
});

test('达到上限后拒绝申请，且不占用新槽位', () => {
  const registry = new AgentStreamRegistry();
  for (let i = 0; i < AgentStreamRegistry.defaultLimit; i += 1) assert.notEqual(registry.acquire(u1), null);
  assert.equal(registry.acquire(u1), null);
  // 被拒的申请不影响已有计数，也不留下可被归还的槽位。
  assert.equal(registry.count(u1), AgentStreamRegistry.defaultLimit);
});

test('归还后计数递减，归零即删键', () => {
  const registry = new AgentStreamRegistry();
  const first = registry.acquire(u1);
  const second = registry.acquire(u1);
  assert.equal(registry.count(u1), 2);
  first?.();
  assert.equal(registry.count(u1), 1);
  first?.();                                      // 幂等：不应再释放
  assert.equal(registry.count(u1), 1);
  second?.();                                     // 归零即删键
  assert.equal(registry.count(u1), 0);
});

test('归还函数幂等：重复调用只释放一次', () => {
  const registry = new AgentStreamRegistry();
  const first = registry.acquire(u1);
  const second = registry.acquire(u1);
  first?.();
  first?.();
  first?.();
  assert.equal(registry.count(u1), 1);
  second?.();
  assert.equal(registry.count(u1), 0);
});

test('自定义上限生效；上限为 0 时一律拒绝', () => {
  const registry = new AgentStreamRegistry();
  assert.notEqual(registry.acquire(u1, 2), null);
  assert.notEqual(registry.acquire(u1, 2), null);
  assert.equal(registry.acquire(u1, 2), null);
  const strict = new AgentStreamRegistry();
  assert.equal(strict.acquire(u2, 0), null);
  assert.equal(strict.count(u2), 0);
});

test('不同用户的槽位互不影响', () => {
  const registry = new AgentStreamRegistry();
  const releaseU1 = registry.acquire(u1);
  const releaseU2 = registry.acquire(u2);
  assert.equal(registry.count(u1), 1);
  assert.equal(registry.count(u2), 1);
  releaseU1?.();
  assert.equal(registry.count(u1), 0);
  assert.equal(registry.count(u2), 1);
  releaseU2?.();
  assert.equal(registry.count(u2), 0);
});
