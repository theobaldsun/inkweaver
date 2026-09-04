/**
 * 回答引用筛选与重编号测试。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectReferencedCitations,
  type RagCitation,
} from './chat.client';

const citations: RagCitation[] = ['one', 'two', 'three', 'four'].map(
  (docId, index) => ({
    docId,
    title: docId,
    chunkIndex: index,
    excerpt: docId,
  }),
);

test('只保留回答实际引用的来源并按出现顺序重新编号', () => {
  const result = selectReferencedCitations(
    '第三条提供结论 [#3]，第一条补充说明 [#1]，仍引用第三条 [#3]。',
    citations,
  );

  assert.equal(
    result.answer,
    '第三条提供结论 [#1]，第一条补充说明 [#2]，仍引用第三条 [#1]。',
  );
  assert.deepEqual(result.citations.map((item) => item.docId), [
    'three',
    'one',
  ]);
});

test('移除越界引用且不会返回未被引用的候选', () => {
  const result = selectReferencedCitations(
    '有效 [#2]，越界 [#9]。',
    citations,
  );

  assert.equal(result.answer, '有效 [#1]，越界 。');
  assert.deepEqual(result.citations.map((item) => item.docId), ['two']);
});

test('回答未包含引用标记时返回空引用列表', () => {
  const result = selectReferencedCitations('依据不足，无法回答。', citations);

  assert.equal(result.answer, '依据不足，无法回答。');
  assert.deepEqual(result.citations, []);
});
