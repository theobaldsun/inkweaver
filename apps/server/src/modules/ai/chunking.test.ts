/**
 * 切块工具单元测试。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkPlainText, htmlToPlainText } from './chunking';

test('htmlToPlainText 剥离标签并解码实体', () => {
  assert.equal(
    htmlToPlainText('<p>你好&nbsp;<strong>世界</strong></p>'),
    '你好 世界',
  );
});

test('chunkPlainText 对短文本返回单块', () => {
  assert.deepEqual(chunkPlainText('短文本'), ['短文本']);
});

test('chunkPlainText 按窗口切分长文本', () => {
  const text = '甲'.repeat(50);
  const chunks = chunkPlainText(text, 20, 5);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 20));
});
