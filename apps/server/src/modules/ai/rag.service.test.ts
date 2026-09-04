/**
 * RAG 候选相关性过滤测试。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { filterRelevantHits, RagService } from './rag.service';

import type { SimilarityHit } from './vector/vector-store';

function hit(docId: string, score: number): SimilarityHit {
  return { docId, score, chunkIndex: 0, title: docId, content: docId };
}

test('同时使用绝对阈值和相对最佳结果阈值过滤无关候选', () => {
  const filtered = filterRelevantHits([
    hit('relevant', 0.4408),
    hit('noise-1', 0.3532),
    hit('noise-2', 0.3486),
    hit('noise-3', 0.334),
    hit('noise-4', 0.2412),
  ]);

  assert.deepEqual(filtered.map((item) => item.docId), ['relevant']);
});

test('多篇与最佳结果接近的文档会共同保留', () => {
  const filtered = filterRelevantHits([
    hit('first', 0.6),
    hit('second', 0.55),
    hit('noise', 0.49),
  ]);

  assert.deepEqual(filtered.map((item) => item.docId), ['first', 'second']);
});

test('最佳结果低于绝对阈值时不向生成模型提供上下文', async () => {
  let receivedHits: SimilarityHit[] | undefined;
  const service = new RagService(
    { async embedQuery() { return [1]; } } as never,
    {
      async answerWithContext(_question: string, hits: SimilarityHit[]) {
        receivedHits = hits;
        return { answer: '无结果', citations: [] };
      },
    } as never,
    {
      async similaritySearch() {
        return [hit('weak', 0.2999)];
      },
    } as never,
  );

  await service.ask('user-1', '问题');

  assert.deepEqual(receivedHits, []);
});
