/**
 * 同步引擎实现（基于 Yjs CRDT）。
 *
 * 用途：
 * - 以平台无关方式编排同步流程：push（本地→云端）+ pull（云端→本地）
 * - 基于 Yjs 实现自动冲突合并
 * - 支持离线编辑和多端同步
 *
 * 输入：SyncEngineOptions（localDB/api 等）
 * 输出：SyncEngine（syncDoc）
 */

import { createLogger } from "@inkweaver/shared";
import * as Y from 'yjs';
import type { LocalDB } from "@inkweaver/db-adapter";

/**
 * 同步引擎选项
 */
export interface SyncEngineOptions {
  /**
   * 本地存储适配器
   */
  localDB: LocalDB;
  /**
   * API 客户端
   */
  api: {
    pull: (
      docId: string,
      cursor?: number,
      limit?: number,
      snapshotVersion?: number,
    ) => Promise<{
      updates: Uint8Array[];
      nextCursor: number;
      hasMore: boolean;
      snapshot?: Uint8Array;
      latestUpdateId?: number;
    }>;
    push: (
      docId: string,
      updates: Uint8Array[],
      baseUpdateId?: number,
    ) => Promise<{ latestUpdateId?: number }>;
  };
  /**
   * 客户端 ID
   */
  clientId: string;
}

/**
 * 同步引擎
 */
export interface SyncEngine {
  /**
   * 同步文档
   */
  syncDoc: (docId: string) => Promise<{ pushed: number; pulled: number }>;
  /**
   * 获取 Yjs 文档
   */
  getYDoc: (docId: string) => Y.Doc;
  /*
   * 清理 Yjs 文档缓存
  */
  clearYDocCache: (docId: string) => void;
}

// 缓存 Yjs 文档实例（带LRU清理机制）
const yDocCache = new Map<string, { doc: Y.Doc; lastAccess: number }>();
const MAX_CACHE_SIZE = 20; // 最大缓存文档数量；架构说明见 docs/架构.md
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟清理一次
const logger = createLogger({ scope: "sync-engine" });

// 定期清理缓存
setInterval(() => {
  cleanupYDocCache();
}, CACHE_CLEANUP_INTERVAL);

function cleanupYDocCache() {
  if (yDocCache.size <= MAX_CACHE_SIZE) return;
  
  // 按最后访问时间排序，删除最旧的文档
  const entries = Array.from(yDocCache.entries());
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  
  // 删除超出最大数量的文档
  const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
  for (const [docId] of toDelete) {
    yDocCache.delete(docId);
    logger.info(`Cleaned up YDoc cache for doc: ${docId}`);
  }
}

/**
 * 创建同步引擎实例。
 *
 * 输入：SyncEngineOptions
 * 输出：SyncEngine
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {

  /**
   * 获取或创建 Yjs 文档实例
   */
  function getYDoc(docId: string): Y.Doc {
    if (!yDocCache.has(docId)) {
      const doc = new Y.Doc();
      // 注意：移除 update 监听，避免重复保存
      // 本地编辑的更新由 DocumentEditPage 的 handleUpdate 统一保存
      yDocCache.set(docId, { doc, lastAccess: Date.now() });
    } else {
      // 更新最后访问时间
      const cached = yDocCache.get(docId)!;
      cached.lastAccess = Date.now();
    }
    return yDocCache.get(docId)!.doc;
  }

  /**
   * 同步文档
   */
  async function syncDoc(docId: string): Promise<{ pushed: number; pulled: number }> {
    try {
      // 1. 获取本地文档和快照状态
      const localDoc = await options.localDB.getDoc(docId).catch(() => null);
      const hasLocalSnapshot = !!localDoc?.yjsSnapshot;
      const lastUpdateId = localDoc?.lastUpdateId || 0; // 使用lastUpdateId作为cursor
      console.log('--------------', localDoc);
      
      // 2. 获取 Yjs 文档实例
      const yDoc = getYDoc(docId);
      
      // 3. 场景处理：基于本地快照状态决定同步策略
      if (hasLocalSnapshot) {
        // 场景B：有本地快照 - 先恢复现场，再拉取增量更新
        logger.info(`场景B：有本地快照，先恢复现场再拉取增量更新`);
        
        try {
          // 应用本地快照恢复现场（秒开）
          Y.applyUpdate(yDoc, localDoc!.yjsSnapshot!);
          logger.info(`Applied local snapshot for doc ${docId}`);
          
          // 拉取服务器增量更新（基于本地lastUpdateId）
          const { updates, snapshot, nextCursor } = await options.api.pull(docId, lastUpdateId, 100, 0);
          const pulled = updates.length;
          
          // 处理服务器快照（仅在需要时应用）
          if (snapshot) {
            // 场景C：本地快照极度落后，服务端返回全量快照
            logger.info(`场景C：本地快照极度落后，应用服务器快照`);
            
            // 应用服务器快照（覆盖本地快照，但保留本地pending更新）
            Y.applyUpdate(yDoc, snapshot);
            
            // 保存服务器快照到本地
            await options.localDB.saveDoc({
              ...localDoc!,
              yjsSnapshot: snapshot,
              updatedAt: new Date().toISOString(),
            });
            logger.info(`Saved server snapshot to local storage for doc ${docId}`);
          }
          
          // 应用增量更新
          for (const update of updates) {
            Y.applyUpdate(yDoc, update);
            await options.localDB.saveUpdate({
              docId,
              update,
              clientId: options.clientId,
              timestamp: Date.now(),
              pending: false,
            });
          }
          localDoc!.lastUpdateId = nextCursor; // 从最后一次 pull 中获取最新的 cursor 作为 lastUpdateId
          // 推送本地pending更新到服务器
          const pushed = await pushPendingUpdatesWithRetry(docId);
          
          // 同步完成后生成新的本地快照
          await generateAndSaveSnapshot(docId, yDoc, localDoc!);
          
          return { pushed, pulled };
          
        } catch (error) {
          logger.error(`场景B同步失败:`, error);
          // 降级处理：保持本地状态，下次重试
          return { pushed: 0, pulled: 0 };
        }
        
      } else {
        // 场景A：无本地快照 - 拉取全量快照+增量更新
        logger.info(`场景A：无本地快照，拉取全量快照+增量更新`);
        
        try {
          // 拉取全量数据（cursor=0）
          const { updates, snapshot, nextCursor } = await options.api.pull(docId, 0, 100, 0);
          console.log('After pull, about to log');
          const pulled = updates.length;
          
          if (snapshot) {
            // 应用服务器快照
            Y.applyUpdate(yDoc, snapshot);
            const testContent = yDoc.getText('content').toString();
            console.log('Content after applying server snapshot:', testContent);
            logger.info(`Applied server snapshot for doc ${docId}`);
            // 快照保存由 generateAndSaveSnapshot 统一处理
          }
          console.log('场景A：全量数据同步完成', updates, snapshot);
          
          // 应用增量更新
          for (const update of updates) {
            Y.applyUpdate(yDoc, update);
            await options.localDB.saveUpdate({
              docId,
              update,
              clientId: options.clientId,
              timestamp: Date.now(),
              pending: false,
            });
          }
          
          // 同步完成后生成新的本地快照
          const docToSave = localDoc || { id: docId, createdAt: new Date().toISOString(), lastUpdateId: null };
          // 关键修复：保存 lastUpdateId
          docToSave.lastUpdateId = nextCursor;
          await generateAndSaveSnapshot(docId, yDoc, docToSave);
          
          const pushed = 0;
          return { pushed, pulled };
          
        } catch (error) {
          logger.error(`场景A同步失败:`, error);
          throw error;
        }
      }
    } catch (error) {
      logger.error('Sync failed:', error);
      throw error;
    }
  }

  /**
   * 冲突时增量拉取并合并到本地 Y.Doc。
   * @returns 更新后的 lastUpdateId
   */
  async function pullIncrementalAfterConflict(docId: string): Promise<number> {
    const localDoc = await options.localDB.getDoc(docId).catch(() => null);
    const cursor = localDoc?.lastUpdateId ?? 0;
    const yDoc = getYDoc(docId);
    const pullResult = await options.api.pull(docId, cursor, 100, 0);

    if (pullResult.snapshot && localDoc) {
      Y.applyUpdate(yDoc, pullResult.snapshot);
    }
    for (const update of pullResult.updates) {
      Y.applyUpdate(yDoc, update);
      await options.localDB.saveUpdate({
        docId,
        update,
        clientId: options.clientId,
        timestamp: Date.now(),
        pending: false,
      });
    }

    const nextId = pullResult.latestUpdateId ?? pullResult.nextCursor ?? cursor;
    if (localDoc) {
      await options.localDB.saveDoc({
        ...localDoc,
        lastUpdateId: nextId,
        updatedAt: new Date().toISOString(),
      });
    }
    return nextId;
  }

  function isPushConflict(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.message.includes('409') || error.message.includes('Conflict')) {
        return true;
      }
    }
    const ax = error as { response?: { status?: number } };
    return ax.response?.status === 409;
  }

  /**
   * 带重试机制的批量推送（分批获取，逐批推送，按 ID 删除）
   */
  async function pushPendingUpdatesWithRetry(docId: string): Promise<number> {
    const maxRetries = 3;
    const batchSize = 100;
    let totalPushed = 0;
    let hasMore = true;

    while (hasMore) {
      // 每次只获取一批 pending 更新（按 id 升序）
      const batch = await options.localDB.getPendingUpdatesBatch?.(docId, batchSize);
      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      const batchIds = batch.map(item => item.id).filter((id): id is number => id !== undefined);
      const batchUpdates = batch.map(item => item.update);
      let success = false;
      let retryCount = 0;

      while (retryCount < maxRetries && !success) {
        try {
          const localDoc = await options.localDB.getDoc(docId).catch(() => null);
          const baseUpdateId = localDoc?.lastUpdateId ?? 0;
          const pushResult = await options.api.push(docId, batchUpdates, baseUpdateId);
          if (pushResult.latestUpdateId !== undefined && localDoc) {
            await options.localDB.saveDoc({
              ...localDoc,
              lastUpdateId: pushResult.latestUpdateId,
              updatedAt: new Date().toISOString(),
            });
          }
          success = true;
          totalPushed += batch.length;
          await options.localDB.clearPendingBatch?.(docId, batchIds);
          logger.info(`Pushed batch of ${batch.length} updates, total pushed: ${totalPushed}`);
        } catch (error) {
          if (isPushConflict(error) && retryCount === 0) {
            logger.warn(`Push conflict for doc ${docId}, pulling and retrying`);
            await pullIncrementalAfterConflict(docId);
            retryCount++;
            continue;
          }
          retryCount++;
          logger.warn(`Push batch failed (attempt ${retryCount}/${maxRetries}):`, error);
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error(`Batch push failed after ${maxRetries} attempts, updates will be retried later`);
            hasMore = false;
            break;
          }
        }
      }
      if (!success) break;
    }

    return totalPushed;
  }

  /**
   * 标记失败的更新
   */
  async function markFailedUpdates(failedBatch: any[], docId: string): Promise<void> {
    try {
      // 这里可以实现更复杂的失败处理逻辑
      // 例如：记录失败次数、设置重试时间等
      logger.warn(`Marking ${failedBatch.length} updates as failed for doc ${docId}`);
      
      // 简单的实现：保留失败的更新，下次同步时重试
      // 在实际应用中，可能需要更复杂的失败处理策略
    } catch (error) {
      logger.error('Failed to mark failed updates:', error);
    }
  }

  /**
   * 生成并保存快照
   */
  async function generateAndSaveSnapshot(docId: string, yDoc: Y.Doc, localDoc: any): Promise<void> {
    try {
      // 生成 Yjs 文档快照
      const snapshot = Y.encodeStateAsUpdate(yDoc);
      
      // 保存快照到本地存储
      await options.localDB.saveDoc({
        ...localDoc,
        yjsSnapshot: snapshot,
        updatedAt: new Date().toISOString(),
      });
      
      logger.info(`Generated and saved new snapshot for doc ${docId}`);
    } catch (error) {
      logger.error(`Failed to generate and save snapshot for doc ${docId}:`, error);
    }
  }

  /**
   * 清理指定文档的YDoc缓存
   */
  function clearYDocCache(docId: string): void {
    if (yDocCache.has(docId)) {
      yDocCache.delete(docId);
      logger.info(`Cleared YDoc cache for doc: ${docId}`);
    }
  }

  return {
    syncDoc,
    getYDoc,
    clearYDocCache,
  };
}
