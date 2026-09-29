import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAgentCitations } from './agent-citations';

const bindings = [
  { label: 'S1', sourceId: '11111111-1111-1111-1111-111111111111' },
  { label: 'S2', sourceId: '22222222-2222-2222-2222-222222222222' },
];

test('标签绑定来源 UUID；重复引用只标记一次，无引用不伪造 cited', () => {
  assert.deepEqual(validateAgentCitations('依据[S2]及[S1]，再次引用[S2]。', bindings), [bindings[1]!.sourceId, bindings[0]!.sourceId]);
  assert.deepEqual(validateAgentCitations('这是不带引用的回答。', bindings), []);
  assert.deepEqual(validateAgentCitations('没有检索到资料。', []), []);
});

test('拒绝不存在、不规范和未闭合引用，不自动修复或删除', () => {
  for (const answer of ['引用[S3]', '引用[S0]', '引用[S01]', '引用[S1,S2]', '引用[S1', '引用[S1\n正文', '引用[S1 ]']) {
    assert.throws(() => validateAgentCitations(answer, bindings), /INVALID_AGENT_CITATION/);
  }
  assert.throws(() => validateAgentCitations('引用[S1]', []), /INVALID_AGENT_CITATION/);
});

test('映射冲突、缺失旧映射与伪造来源 ID 均失败，不猜测标签', () => {
  assert.throws(() => validateAgentCitations('正文', [...bindings, bindings[0]!]), /INVALID_AGENT_CITATION/);
  assert.throws(() => validateAgentCitations('正文', [{ ...bindings[0]!, sourceId: 'other' }]), /INVALID_AGENT_CITATION/);
  assert.throws(() => validateAgentCitations('正文', undefined as never), /INVALID_AGENT_CITATION/);
});
