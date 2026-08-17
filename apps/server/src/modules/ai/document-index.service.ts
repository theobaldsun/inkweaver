/**
 * 文档向量索引调度服务。
 *
 * 用途：
 * - 接收文档投影完成后的索引请求，通过 BullMQ 队列异步执行向量重建
 * - 提供删除文档时的向量数据同步清理能力
 *
 * 数据来源：
 * - 索引触发方：documents.service.ts（文档创建/更新后调用 scheduleReindex）
 * - 实际执行者：ai-index.processor.ts（Worker，负责切块→嵌入→写入 pgvector）
 *
 * 关键策略：
 * - 固定 jobId 去重：同一 docId 的索引用 `reindex-${docId}` 合并，只保留最新内容
 * - active 冲突延迟处理：当索引正在执行时，新请求以 30s 延迟任务入队，避免丢失
 * - 软删除兜底：延迟任务再次被编辑时会被替换，防止多次编辑堆积延迟任务
 *
 * 依赖：
 * - BullMQ Queue（ai-document-index 队列）：异步索引任务调度
 * - VectorStore（pgvector）：向量数据持久化
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
   *
   * 调用时机：文档创建、更新、恢复后，由 DocumentsService 调用。
   *
   * 三阶段处理策略：
   * 1. **清理阶段**：查找已有任务，根据状态决定是否移除
   *    - waiting / delayed / prioritized → 移除后以最新 payload 重入队
   *    - active → 不移除（正在执行，无法安全终止）
   *    - completed / failed → 不移除（已结束，直接 add 会重建）
   * 2. **入队阶段**：以固定 jobId `reindex-${docId}` 入队
   *    - 同一 docId 只会有一个主任务，天然去重
   * 3. **冲突兜底**：若 add 因 active 任务冲突抛错（BullMQ `Job already exist`），
   *    改为调用 enqueueDelayedReindex 延迟 30s 入队
   *
   * 延迟重入队的必要性：
   * active 任务正在执行切块→嵌入→写入 pgvector，无法中断。
   * 若此时用户再次编辑文档，新内容必须在 active 任务完成后被索引。
   * 30s 延迟确保 active 任务（通常数秒）有充足时间完成。
   *
   * @param payload 文档索引载荷（含 docId、userId、title、content 全量快照）
   */
  async scheduleReindex(payload: AiIndexJobPayload): Promise<void> {
    const jobId = `reindex-${payload.docId}`;

    // 第一步：清理非活跃状态的旧任务
    const existing = await this.indexQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
        await existing.remove();
      }
      // active / completed / failed 状态的任务不移除
      // - active：正在执行，强行移除可能导致向量库不一致
      // - completed/failed：已结束，直接 add 会以相同 jobId 重建
    }

    // 第二步：尝试以固定 jobId 入队
    try {
      await this.indexQueue.add('reindex', payload, {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    } catch (error) {
      // 第三步：如果因 active 任务导致冲突，走延迟重入队
      if (error instanceof Error && error.message.includes('Job already exist')) {
        await this.enqueueDelayedReindex(payload);
      } else {
        this.logger.warn(`入队索引失败 docId=${payload.docId}`, error);
      }
    }
  }

  /**
   * 延迟重入队：当 active 任务占用 jobId 时，以独立 jobId 延迟入队。
   *
   * 流程：
   * 1. 先移除已有的延迟任务（去重，只保留最新一次编辑的内容）
   * 2. 以 30s 延迟入队，等待 active 任务完成后再执行
   * 3. 延迟任务完成后通过 removeOnComplete 自动清理
   *
   * 与主任务的区别：
   * - jobId 为 `reindex-${docId}-delayed`（独立于主任务，不冲突）
   * - 带有 30s delay 参数，BullMQ 会在延迟期满后调度执行
   *
   * 多次编辑场景：
   * 用户在 30s 内连续编辑 5 次 → 第 1 次编辑触发主任务，
   * 后续 4 次编辑会各自尝试入队→冲突→替换延迟任务，
   * 最终只有最后一次编辑的内容会被延迟索引。
   *
   * @param payload 文档索引载荷
   */
  private async enqueueDelayedReindex(payload: AiIndexJobPayload): Promise<void> {
    const delayedJobId = `reindex-${payload.docId}-delayed`;
    try {
      const oldDelayed = await this.indexQueue.getJob(delayedJobId);
      if (oldDelayed) {
        await oldDelayed.remove();
      }
      await this.indexQueue.add('reindex', payload, {
        jobId: delayedJobId,
        delay: 30_000,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      this.logger.log(
        `文档索引延迟入队 docId=${payload.docId}，将在 30s 后执行以覆盖 active 任务`,
      );
    } catch (delayedError) {
      this.logger.warn(`延迟索引入队失败 docId=${payload.docId}`, delayedError);
    }
  }

  /**
   * 硬删文档时同步清理索引队列与向量数据。
   *
   * 调用时机：文档永久删除（emptyTrash、purgeExpiredTrash、hardDeleteDocument）。
   *
   * 清理顺序：
   * 1. 从队列中移除待执行的索引任务（防止删除后仍被索引）
   * 2. 从 pgvector 中物理删除该文档的所有向量行
   *
   * @param docId 文档 ID
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