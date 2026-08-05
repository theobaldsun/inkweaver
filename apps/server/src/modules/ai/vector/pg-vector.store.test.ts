/**
 * pgvector 字面量与维度校验单测。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_EMBEDDING_DIMENSIONS } from '../../../config/ai.config';
import { toPgVectorLiteral } from './pg-vector.store';

test('toPgVectorLiteral 生成合法字面量', () => {
  const embedding = Array.from({ length: AI_EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? 0.5 : 0,
  );
  const literal = toPgVectorLiteral(embedding);
  assert.ok(literal.startsWith('['));
  assert.ok(literal.endsWith(']'));
  assert.ok(literal.includes('0.5'));
});

test('toPgVectorLiteral 维度错误时抛错', () => {
  assert.throws(() => toPgVectorLiteral([1, 2, 3]));
});
