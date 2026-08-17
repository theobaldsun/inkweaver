/**
 * 快照生成服务
 *
 * 核心职责：
 * - 根据策略（更新数量、时间间隔）定期生成文档全量快照
 * - 管理快照的调度、生成和查询
 * - 为文档投影（DocumentProjection）提供快照数据源
 *
 * 数据来源：
 * - sync_updates 表（SyncUpdate 实体）：Yjs 增量更新记录
 * - doc_snapshots 表（DocSnapshot 实体）：文档全量快照（每文档唯一一条，UNIQUE docId）
 *
 * 关键策略：
 * - 快照合并：将该文档所有增量 update 逐条 apply 到新的 Y.Doc，再编码为全量快照
 * - 调度防抖：同一文档 5 秒内多次触发只生成一次快照（pending Map 做 timer 合并）
 * - 资源释放：每次生成后用 yDoc.destroy() 释放 Yjs Doc 实例，防止内存泄漏
 * - 唯一快照：doc_snapshots 表对 docId 有唯一索引，生成时使用 upsert 覆盖旧快照
 */

import { base64ToUint8Array, uint8ArrayToBase64 } from '@inkweaver/shared';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as Y from 'yjs';

import { DocSnapshot } from './entity/doc-snapshot.entity';
import { SyncUpdate } from './entity/sync-update.entity';

/**
 * 快照生成策略选项
 */
interface SnapshotGenerationOptions {
  /** 文档 ID */
  docId: string;
  /** 最大更新数量阈值：超过此数量的增量更新后触发快照 */
  maxUpdates?: number;
  /** 时间阈值（毫秒）：距上次快照超过此时间后触发快照 */
  timeThreshold?: number;
  /** 强制生成：忽略阈值判断，直接生成快照 */
  forceGeneration?: boolean;
}

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  /** 默认最大增量更新数：超过 1000 条增量后生成快照 */
  private readonly defaultMaxUpdates = 1000;

  /** 默认时间阈值：1 小时无快照则生成新快照 */
  private readonly defaultTimeThreshold = 3600000;

  /** 防抖定时器 Map：docId → setTimeout 句柄。同一文档 5 秒内多次触发只生成一次快照 */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    @InjectRepository(DocSnapshot)
    private docSnapshotRepository: Repository<DocSnapshot>,
  ) {}

  /**
   * 判断是否需要为指定文档生成快照
   *
   * 判定逻辑（满足任一即需要生成）：
   * 1. forceGeneration=true（强制生成）
   * 2. 尚无快照记录
   * 3. 距上次快照的增量更新数 >= maxUpdates
   * 4. 距上次快照的时间 >= timeThreshold
   *
   * @param docId 文档 ID
   * @param options 策略选项（可覆盖默认阈值）
   * @returns true=需要生成快照
   */
  async shouldGenerateSnapshot(docId: string, options: Partial<SnapshotGenerationOptions> = {}): Promise<boolean> {
    const {
      maxUpdates = this.defaultMaxUpdates,
      timeThreshold = this.defaultTimeThreshold,
      forceGeneration = false
    } = options;

    if (forceGeneration) {
      return true;
    }

    const latestSnapshot = await this.docSnapshotRepository.findOne({
      where: { docId },
      order: { version: 'DESC' },
    });

    if (!latestSnapshot) {
      return true;
    }

    // 统计自上次快照以来的增量更新数
    const updateCount = await this.syncUpdateRepository.count({
      where: {
        docId,
        updateId: MoreThan(latestSnapshot.version),
      },
    });

    if (updateCount >= maxUpdates) {
      this.logger.log(`Snapshot needed for doc ${docId}: update count ${updateCount} >= ${maxUpdates}`);
      return true;
    }

    const timeSinceLastSnapshot = Date.now() - latestSnapshot.updatedAt.getTime();
    if (timeSinceLastSnapshot >= timeThreshold) {
      this.logger.log(`Snapshot needed for doc ${docId}: time since last snapshot ${timeSinceLastSnapshot}ms >= ${timeThreshold}ms`);
      return true;
    }

    return false;
  }

  /**
   * 调度快照生成（防抖）
   *
   * 同一文档在 delayMs 内多次调用会合并为一次生成，避免频繁触发。
   * 使用 timer.unref() 确保定时器不会阻塞进程退出。
   *
   * @param docId 文档 ID
   * @param delayMs 防抖延迟（默认 5000ms）
   */
  scheduleSnapshot(docId: string, delayMs = 5000): void {
    const existing = this.pending.get(docId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pending.delete(docId);
      this.shouldGenerateSnapshot(docId)
        .then((shouldGenerate) => shouldGenerate ? this.generateSnapshot(docId) : null)
        .catch((error) => this.logger.warn(`Snapshot generation failed docId=${docId}`, error));
    }, delayMs);
    timer.unref?.();
    this.pending.set(docId, timer);
  }

  /**
   * 生成文档快照
   *
   * 流程：
   * 1. 加载该文档所有增量 update（按 updateId 升序）
   * 2. 创建 Y.Doc 实例，逐条 applyUpdate 合并为全量状态
   * 3. 编码为 Base64 快照，upsert 到 doc_snapshots 表
   * 4. finally 中释放 yDoc.destroy()，防止内存泄漏
   *
   * @param docId 文档 ID
   * @returns 生成的快照记录，无更新时返回 null
   */
  async generateSnapshot(docId: string): Promise<DocSnapshot | null> {
    try {
      this.logger.log(`Generating snapshot for doc ${docId}`);

      const updates = await this.syncUpdateRepository.find({
        where: { docId },
        order: { updateId: 'ASC' },
      });

      if (updates.length === 0) {
        this.logger.warn(`No updates found for doc ${docId}, cannot generate snapshot`);
        return null;
      }

      const yDoc = new Y.Doc();

      try {
        // 逐条应用增量更新到 Yjs 文档
        for (const update of updates) {
          try {
            const uint8Array = base64ToUint8Array(update.update);
            Y.applyUpdate(yDoc, uint8Array);
          } catch (error) {
            this.logger.error(`Failed to apply update ${update.updateId} for doc ${docId}:`, error);
            return null;
          }
        }

        // 编码全量状态为快照
        const snapshotData = Y.encodeStateAsUpdate(yDoc);
        const snapshotBase64 = uint8ArrayToBase64(snapshotData);

        const latestUpdate = updates[updates.length - 1];

        if (!latestUpdate) {
          this.logger.warn(`No updates found for doc ${docId}, cannot generate snapshot`);
          return null;
        }

        // upsert 覆盖旧快照（docId 唯一索引保证只有一条记录）
        await this.docSnapshotRepository.upsert(
          {
            docId,
            snapshot: snapshotBase64,
            version: latestUpdate.updateId,
            updateCount: updates.length,
            size: snapshotBase64.length,
          },
          { conflictPaths: ['docId'] }
        );

        const savedSnapshot = await this.docSnapshotRepository.findOne({ where: { docId } });

        if (savedSnapshot) {
          this.logger.log(`Snapshot generated for doc ${docId}: version ${savedSnapshot.version}, size ${savedSnapshot.size} bytes`);
        }

        return savedSnapshot;
      } finally {
        // 释放 Yjs Doc 内部状态，防止内存泄漏
        yDoc.destroy();
      }

    } catch (error) {
      this.logger.error(`Failed to generate snapshot for doc ${docId}:`, error);
      return null;
    }
  }

  /**
   * 获取文档的最新快照
   *
   * @param docId 文档 ID
   * @returns 最新快照记录，不存在时返回 null
   */
  async getLatestSnapshot(docId: string): Promise<DocSnapshot | null> {
    return this.docSnapshotRepository.findOne({
      where: { docId },
      order: { version: 'DESC' },
    });
  }

  /**
   * 定期快照生成任务
   *
   * 遍历所有有增量更新的文档，对每个文档判断是否满足快照条件，
   * 满足则生成快照。由定时任务（Cron）调用。
   */
  async runPeriodicSnapshotGeneration(): Promise<void> {
    try {
      this.logger.log('Starting periodic snapshot generation');

      // 查出所有有增量更新的文档 ID
      const docsWithUpdates = await this.syncUpdateRepository
        .createQueryBuilder('update')
        .select('update.docId')
        .distinct(true)
        .getRawMany();

      let generatedCount = 0;

      for (const doc of docsWithUpdates) {
        const docId = doc.update_docId;

        if (await this.shouldGenerateSnapshot(docId)) {
          const snapshot = await this.generateSnapshot(docId);
          if (snapshot) {
            generatedCount++;
          }
        }
      }

      this.logger.log(`Periodic snapshot generation completed: ${generatedCount} snapshots generated`);

    } catch (error) {
      this.logger.error('Periodic snapshot generation failed:', error);
    }
  }

  /**
   * 手动触发快照生成
   *
   * @param docId 文档 ID
   * @returns 生成的快照记录
   */
  async triggerSnapshotGeneration(docId: string): Promise<DocSnapshot | null> {
    return this.generateSnapshot(docId);
  }
}