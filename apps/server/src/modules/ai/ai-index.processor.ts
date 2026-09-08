/**
 * BullMQ Worker：切块 → 嵌入 → 写入 pgvector。
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AI_INDEX_QUEUE, type AiIndexJobPayload } from './ai.constants';
import { chunkPlainText, htmlToPlainText } from './chunking';
import { EmbeddingClient } from './embedding.client';
import { VECTOR_STORE } from './vector/vector-store.token';

import type { VectorStore } from './vector/vector-store';

@Processor(AI_INDEX_QUEUE, { concurrency: 1 })
export class AiIndexProcessor extends WorkerHost {
  private readonly logger = new Logger(AiIndexProcessor.name);

  constructor(
    private readonly embeddingClient: EmbeddingClient,
    @Inject(VECTOR_STORE)
    private readonly vectorStore: VectorStore,
  ) {
    super();
  }

  /**
   * 处理单篇文档重索引。
   */
  async process(job: Job<AiIndexJobPayload>): Promise<void> {
    const { docId, userId, title, content } = job.data;
    const plain = htmlToPlainText(content);
    const chunks = chunkPlainText(plain);

    if (chunks.length === 0) {
      await this.vectorStore.deleteByDocId(docId);
      this.logger.log(`文档无正文，已清空向量 docId=${docId}`);
      return;
    }

    const embeddings = await this.embeddingClient.embedDocuments(chunks);
    await this.vectorStore.replaceDocChunks(
      chunks.map((text, chunkIndex) => ({
        userId,
        docId,
        chunkIndex,
        title,
        content: text,
        embedding: embeddings[chunkIndex]!,
      })),
    );

    this.logger.log(
      `文档已索引 docId=${docId} chunks=${chunks.length} jobId=${job.id}`,
    );
  }
}
