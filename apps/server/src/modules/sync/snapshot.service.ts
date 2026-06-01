/**
 * 快照生成服务
 * 
 * 用途：
 * - 定期生成文档的全量快照
 * - 管理快照的生成策略和缓存
 * - 提供快照查询和清理功能
 * 
 * 输入：文档ID、更新记录
 * 输出：快照数据
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as Y from 'yjs';
import { base64ToUint8Array, uint8ArrayToBase64 } from '@inkweaver/shared';

import { SyncUpdate } from './entity/sync-update.entity';
import { DocSnapshot } from './entity/doc-snapshot.entity';

interface SnapshotGenerationOptions {
  docId: string;
  maxUpdates?: number; // 最大更新数量阈值
  timeThreshold?: number; // 时间阈值（毫秒）
  forceGeneration?: boolean; // 强制生成快照
}

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);
  private readonly defaultMaxUpdates = 1000; // 默认最大更新数量
  private readonly defaultTimeThreshold = 3600000; // 默认1小时

  constructor(
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    @InjectRepository(DocSnapshot)
    private docSnapshotRepository: Repository<DocSnapshot>,
  ) {}

  /**
   * 检查是否需要生成快照
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

    // 获取最新的快照
    const latestSnapshot = await this.docSnapshotRepository.findOne({
      where: { docId },
      order: { version: 'DESC' },
    });

    // 如果没有快照，需要生成
    if (!latestSnapshot) {
      return true;
    }

    // 检查更新数量
    const updateCount = await this.syncUpdateRepository.count({
      where: { 
        docId, 
        updateId: latestSnapshot.version 
      },
    });

    if (updateCount >= maxUpdates) {
      this.logger.log(`Snapshot needed for doc ${docId}: update count ${updateCount} >= ${maxUpdates}`);
      return true;
    }

    // 检查时间阈值
    const timeSinceLastSnapshot = Date.now() - latestSnapshot.updatedAt.getTime();
    if (timeSinceLastSnapshot >= timeThreshold) {
      this.logger.log(`Snapshot needed for doc ${docId}: time since last snapshot ${timeSinceLastSnapshot}ms >= ${timeThreshold}ms`);
      return true;
    }

    return false;
  }

  /**
   * 生成文档快照
   */
  async generateSnapshot(docId: string): Promise<DocSnapshot | null> {
    try {
      this.logger.log(`Generating snapshot for doc ${docId}`);

      // 获取文档的所有更新
      const updates = await this.syncUpdateRepository.find({
        where: { docId },
        order: { updateId: 'ASC' },
      });

      if (updates.length === 0) {
        this.logger.warn(`No updates found for doc ${docId}, cannot generate snapshot`);
        return null;
      }

      // 创建 Yjs 文档并应用所有更新
      const yDoc = new Y.Doc();
      
      for (const update of updates) {
        try {
          // 将 Base64 解码为 Uint8Array（使用共享工具）
          const uint8Array = base64ToUint8Array(update.update);
          Y.applyUpdate(yDoc, uint8Array);
        } catch (error) {
          this.logger.error(`Failed to apply update ${update.updateId} for doc ${docId}:`, error);
          // 继续处理下一个更新
        }
      }

      // 生成快照（使用共享工具）
      const snapshotData = Y.encodeStateAsUpdate(yDoc);
      const snapshotBase64 = uint8ArrayToBase64(snapshotData);
      
      // 获取最新的 update_id
      const latestUpdate = updates[updates.length - 1];
      
      if (!latestUpdate) {
        this.logger.warn(`No updates found for doc ${docId}, cannot generate snapshot`);
        return null;
      }
      
      // 创建或更新快照记录（使用 upsert 避免重复键冲突）
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
      
      // 获取保存后的快照记录
      const savedSnapshot = await this.docSnapshotRepository.findOne({ where: { docId } });
      
      if (savedSnapshot) {
        this.logger.log(`Snapshot generated for doc ${docId}: version ${savedSnapshot.version}, size ${savedSnapshot.size} bytes`);
      }
      
      return savedSnapshot;
      
    } catch (error) {
      this.logger.error(`Failed to generate snapshot for doc ${docId}:`, error);
      return null;
    }
  }

  /**
   * 获取文档的最新快照
   */
  async getLatestSnapshot(docId: string): Promise<DocSnapshot | null> {
    return this.docSnapshotRepository.findOne({
      where: { docId },
      order: { version: 'DESC' },
    });
  }

  /**
   * 清理旧的快照
   */
  async cleanupOldSnapshots(docId: string, keepCount: number = 3): Promise<void> {
    try {
      const snapshots = await this.docSnapshotRepository.find({
        where: { docId },
        order: { version: 'DESC' },
      });

      if (snapshots.length > keepCount) {
        const snapshotsToDelete = snapshots.slice(keepCount);
        await this.docSnapshotRepository.remove(snapshotsToDelete);
        
        this.logger.log(`Cleaned up ${snapshotsToDelete.length} old snapshots for doc ${docId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup snapshots for doc ${docId}:`, error);
    }
  }

  /**
   * 定期快照生成任务
   */
  async runPeriodicSnapshotGeneration(): Promise<void> {
    try {
      this.logger.log('Starting periodic snapshot generation');
      
      // 获取所有有更新的文档
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
            // 清理旧的快照
            await this.cleanupOldSnapshots(docId);
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
   */
  async triggerSnapshotGeneration(docId: string): Promise<DocSnapshot | null> {
    const snapshot = await this.generateSnapshot(docId);
    if (snapshot) {
      await this.cleanupOldSnapshots(docId);
    }
    return snapshot;
  }
}