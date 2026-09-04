/**
 * RAG 问答编排：嵌入查询 → 向量检索 → Chat 生成。
 */

import { Inject, Injectable } from '@nestjs/common';

import { ChatClient, type RagAnswerResult } from './chat.client';
import { EmbeddingClient } from './embedding.client';
import { VECTOR_STORE } from './vector/vector-store.token';

import type { SimilarityHit, VectorStore } from './vector/vector-store';

/** RAG 候选必须达到的最低余弦相似度，与混合搜索的语义噪声阈值一致。 */
export const RAG_MIN_SIMILARITY = 0.3;

/**
 * 相对最佳候选的保留比例。
 *
 * 绝对阈值只能过滤明显噪声；相对阈值进一步阻止“虽然超过 0.3、但明显弱于最佳结果”
 * 的文档被塞进上下文。两者同时生效，兼顾无答案拒答与多篇强相关文档召回。
 */
export const RAG_RELATIVE_SCORE_RATIO = 0.85;

/**
 * 从 Top-K 候选中保留真正相关的分块，并保持原有相似度顺序。
 */
export function filterRelevantHits(hits: SimilarityHit[]): SimilarityHit[] {
  const validHits = hits.filter((hit) => Number.isFinite(hit.score));
  if (validHits.length === 0) return [];

  const bestScore = Math.max(...validHits.map((hit) => hit.score));
  if (bestScore < RAG_MIN_SIMILARITY) return [];

  const threshold = Math.max(
    RAG_MIN_SIMILARITY,
    bestScore * RAG_RELATIVE_SCORE_RATIO,
  );
  return validHits.filter((hit) => hit.score >= threshold);
}

@Injectable()
export class RagService {
  constructor(
    private readonly embeddingClient: EmbeddingClient,
    private readonly chatClient: ChatClient,
    @Inject(VECTOR_STORE)
    private readonly vectorStore: VectorStore,
  ) {}

  /**
   * 对当前用户笔记做 RAG 问答。
   * 输入：userId、question、可选 docIds / topK；输出：answer + citations
   */
  async ask(
    userId: string,
    question: string,
    options?: { docIds?: string[]; topK?: number },
  ): Promise<RagAnswerResult> {
    const queryEmbedding = await this.embeddingClient.embedQuery(question);
    const candidates = await this.vectorStore.similaritySearch(
      userId,
      queryEmbedding,
      options?.topK ?? 5,
      options?.docIds,
    );
    const hits = filterRelevantHits(candidates);
    return this.chatClient.answerWithContext(question, hits);
  }
}
