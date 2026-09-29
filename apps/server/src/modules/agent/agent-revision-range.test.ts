/** 章节范围的确定性拼接验证，不使用模型或数据库。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRevisionRange, assertRevisionBoundary, validateRevisionRange } from './agent-revision-range';

test('重复标题也按固定偏移替换，范围外字符及引用逐字保留', () => {
  const before = '# 同名\r\n保留 [S1] 😀\r\n';
  const selected = '# 同名\r\n修改这里\r\n';
  const after = '# 结尾\r\n保持 [S2]\r\n';
  assert.equal(applyRevisionRange(before + selected + after, { start: before.length, end: before.length + selected.length }, '# 同名\r\n新内容 [S3]\r\n'),
    before + '# 同名\r\n新内容 [S3]\r\n' + after);
});

test('拒绝越界、半个代理对、CRLF 及引用标签边界', () => {
  for (const [text, range] of [
    ['abc', { start: -1, end: 1 }], ['abc', { start: 2, end: 2 }], ['abc', { start: 0, end: 4 }],
    ['😀正文', { start: 1, end: 3 }], ['a\r\nb', { start: 2, end: 4 }], ['[S12]正文', { start: 0, end: 3 }],
  ] as const) assert.throws(() => validateRevisionRange(text, range), /INVALID_AGENT_REVISION_RANGE/);
});

test('空替换及合并后超字节上限拒绝；完整稿件也可以是一个合法范围', () => {
  assert.equal(applyRevisionRange('旧稿', { start: 0, end: 2 }, '新稿'), '新稿');
  assert.throws(() => applyRevisionRange('旧稿', { start: 0, end: 2 }, ' '), /REPLACEMENT/);
  assert.throws(() => applyRevisionRange('旧稿', { start: 0, end: 1 }, '中'.repeat(90000)), /TOO_LARGE/);
});


test('持久化边界校验拒绝范围外变化和前后缀重叠伪装', () => {
  assertRevisionBoundary('前文旧后文', { start: 2, end: 3 }, '前文新后文');
  assert.throws(() => assertRevisionBoundary('前文旧后文', { start: 2, end: 3 }, '改变新后文'), /OUTSIDE_RANGE/);
  assert.throws(() => assertRevisionBoundary('abXab', { start: 2, end: 3 }, 'ab'), /OUTSIDE_RANGE/);
});
