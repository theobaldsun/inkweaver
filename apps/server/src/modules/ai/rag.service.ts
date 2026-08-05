/**
 * RAG 问答编排：嵌入查询 → 向量检索 → Chat 生成。
 */

import { Injectable } from '@nestjs/common';

import { ChatClient, type RagAnswerResult } from './chat.client';
import { EmbeddingClient } from './embedding.client';
import type { VectorStore } from './vector/vector-store';
import { VECTOR_STORE } from './vector/vector-store.token';
import { Inject } from '@nestjs/common';

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
    const hits = await this.vectorStore.similaritySearch(
      userId,
      queryEmbedding,
      options?.topK ?? 5,
      options?.docIds,
    );
    return this.chatClient.answerWithContext(question, hits);
  }
}
