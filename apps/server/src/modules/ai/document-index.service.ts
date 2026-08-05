/**
 * 文档索引调度：投影完成后入队重建向量切块。
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { AI_INDEX_QUEUE, type AiIndexJobPayload } from './ai.constants';
import type { VectorStore } from './vector/vector-store';
import { VECTOR_STORE } from './vector/vector-store.token';

@Injectable()
export class DocumentIndexService {
  private readonly logger = new Logger(DocumentIndexService.name);

  constructor(
    @InjectQueue(AI_INDEX_QUEUE)
    private readonly indexQueue: Queue<AiIndexJobPayload>,
    @Inject(VECTOR_STORE)
    private readonly vectorStore: VectorStore,
  ) {}

  /**
   * 防抖式入队（同 docId 合并为最新任务）。
   * 输入：payload；输出：无
   */
  async scheduleReindex(payload: AiIndexJobPayload): Promise<void> {
    try {
      const jobId = `reindex-${payload.docId}`;
      const existing = await this.indexQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
          await existing.remove();
        }
      }
      await this.indexQueue.add('reindex', payload, {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    } catch (error) {
      this.logger.warn(`入队索引失败 docId=${payload.docId}`, error);
    }
  }

  /**
   * 硬删时同步清理向量行。
   * 输入：docId；输出：无
   */
  async deleteByDocId(docId: string): Promise<void> {
    try {
      await this.indexQueue.remove(`reindex-${docId}`).catch(() => undefined);
      await this.vectorStore.deleteByDocId(docId);
    } catch (error) {
      this.logger.warn(`删除文档向量失败 docId=${docId}`, error);
    }
  }
}
