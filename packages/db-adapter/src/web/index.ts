import Dexie from 'dexie';
import type { Document, SyncUpdate } from '@inkweaver/shared';
import { uint8ArrayToBase64, base64ToUint8Array } from '@inkweaver/shared';
import type { LocalDB } from '..';

// 添加 navigator.storage 的类型声明
declare global {
  interface Navigator {
    storage?: {
      estimate(): Promise<{
        usage: number;
        quota: number;
      }>;
    };
  }
}

const MAX_SNAPSHOT_DOCS = 20;
const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;

/**
 * 基于 Dexie (IndexedDB) 的 Web 本地存储实现
 */
export class WebLocalDB implements LocalDB {
  private db: Dexie;

  constructor() {
    this.db = new Dexie('InkWeaverDB');
    this.db.version(1).stores({
      documents: 'id, title, userId, createdAt, updatedAt, lastAccessedAt',
      syncUpdates: '++id, docId, clientId, timestamp, pending',
    });
    
    // 升级版本以支持 yjsSnapshot 字段
    this.db.version(2).stores({
      documents: 'id, title, userId, createdAt, updatedAt, lastAccessedAt, yjsSnapshot',
      syncUpdates: '++id, docId, clientId, timestamp, pending',
    }).upgrade(trans => {
      // 迁移数据：为现有文档添加 yjsSnapshot 字段
      return trans.table('documents').toCollection().modify(doc => {
        doc.yjsSnapshot = null;
      });
    });
    
    // 升级版本以支持 lastUpdateId 字段
    this.db.version(3).stores({
      documents: 'id, title, userId, createdAt, updatedAt, lastAccessedAt, yjsSnapshot, lastUpdateId',
      syncUpdates: '++id, docId, clientId, timestamp, pending',
    }).upgrade(trans => {
      // 迁移数据：为现有文档添加 lastUpdateId 字段
      return trans.table('documents').toCollection().modify(doc => {
        doc.lastUpdateId = 0;
      });
    });
  }

  async saveDoc(doc: Document): Promise<void> {
    // 将 Uint8Array 类型的 yjsSnapshot 转换为 Base64 字符串存储
    const docToSave: any = {
      ...doc,
      lastAccessedAt: Date.now(),
    };
    
    if (doc.yjsSnapshot) {
      // 将 Uint8Array 转换为 Base64 编码的字符串（使用共享工具）
      docToSave.yjsSnapshot = uint8ArrayToBase64(doc.yjsSnapshot);
    }
    
    await this.db.table('documents').put(docToSave);
    await this.enforceSnapshotCachePolicy();
  }

  /**
   * LRU 淘汰快照：最多 20 篇且总估算不超过 200MB。
   */
  private async enforceSnapshotCachePolicy(): Promise<void> {
    const all = await this.db.table('documents').toArray();
    const withSnapshot = all
      .filter((d) => d.yjsSnapshot)
      .map((d) => ({
        id: d.id as string,
        lastAccessedAt: (d.lastAccessedAt as number) || 0,
        size: typeof d.yjsSnapshot === 'string' ? d.yjsSnapshot.length : 0,
      }));

    if (withSnapshot.length === 0) return;

    withSnapshot.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    let totalBytes = withSnapshot.reduce((sum, d) => sum + d.size, 0);
    const toEvict: string[] = [];

    while (
      (withSnapshot.length - toEvict.length > MAX_SNAPSHOT_DOCS || totalBytes > MAX_SNAPSHOT_BYTES) &&
      toEvict.length < withSnapshot.length
    ) {
      const victim = withSnapshot[toEvict.length];
      if (!victim) break;
      toEvict.push(victim.id);
      totalBytes -= victim.size;
    }

    for (const id of toEvict) {
      await this.db.table('documents').update(id, { yjsSnapshot: null });
    }
  }

  async getDoc(id: string): Promise<Document> {
    const doc = await this.db.table('documents').get(id);
    if (!doc) {
      throw new Error(`Document ${id} not found`);
    }
    
    // 更新最后访问时间
    await this.db.table('documents').update(id, { lastAccessedAt: Date.now() });
    
    // 将 Base64 字符串转换回 Uint8Array（使用共享工具）
    if (doc.yjsSnapshot) {
      doc.yjsSnapshot = base64ToUint8Array(doc.yjsSnapshot);
    }
    
    return doc;
  }

  async saveUpdate(update: SyncUpdate): Promise<void> {
    // 将 Uint8Array 转换为 Base64 编码的字符串（使用共享工具）
    const base64Update = uint8ArrayToBase64(update.update);
    await this.db.table('syncUpdates').add({
      ...update,
      update: base64Update, // 存储 Base64 编码的字符串
      pending: update.pending !== false, // 如果没有明确指定 pending，则默认为 true
    });
  }

  async getUpdatesSince(docId: string, since: number): Promise<SyncUpdate[]> {
    const updates = await this.db.table('syncUpdates')
      .where('docId').equals(docId)
      .filter(item => item.timestamp > since)
      .toArray();
    
    // 将 Base64 编码的字符串转换为 Uint8Array（使用共享工具）
    return updates.map(item => ({
      ...item,
      update: base64ToUint8Array(item.update),
    }));
  }

  async getPendingUpdates(docId: string): Promise<SyncUpdate[]> {
    const updates = await this.db.table('syncUpdates')
      .where('docId').equals(docId)
      .filter(item => item.pending)
      .toArray();
    
    // 将 Base64 编码的字符串转换为 Uint8Array（使用共享工具）
    return updates.map(item => ({
      ...item,
      update: base64ToUint8Array(item.update),
    }));
  }

  // 新增：分页获取 pending 更新，按 id 升序，保证先进先出
  async getPendingUpdatesBatch(docId: string, limit: number): Promise<SyncUpdate[]> {
    const items = await this.db.table('syncUpdates')
    .where('docId').equals(docId)
    .filter(item => item.pending === true)
    .sortBy('id');  // 按自增主键升序
    const batch = items.slice(0, limit);
    
    // 将 Base64 字符串转换回 Uint8Array（使用共享工具）
    return batch.map(item => ({
      ...item,
      update: base64ToUint8Array(item.update),
    }));
  }

  // 新增：根据 id 列表批量删除记录
  async clearPendingBatch(docId: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.table('syncUpdates')
      .where('id').anyOf(ids)
      .delete();
  }

  async clearPending(docId: string): Promise<void> {
    await this.db.table('syncUpdates')
      .where('docId').equals(docId)
      .filter(item => item.pending)
      .delete();
  }
  async getAllDocuments(): Promise<Document[]> {
    const docs = await this.db.table('documents').toArray();
    // 将 Base64 的 yjsSnapshot 转换回 Uint8Array
    return docs.map(doc => {
      if (doc.yjsSnapshot) {
        const binaryString = atob(doc.yjsSnapshot);
        const length = binaryString.length;
        const uint8Array = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
        doc.yjsSnapshot = uint8Array;
      }
      return doc;
    });
  }
  // 清理过期记录（超过7天的已同步更新）
  async cleanupExpiredUpdates(): Promise<void> {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    await this.db.table('syncUpdates')
      .where('timestamp').below(sevenDaysAgo)
      .filter(item => !item.pending)
      .delete();
  }

  // 缓存清除逻辑
  async cleanupCache(): Promise<void> {
    try {
      // 1. 清理过期更新记录
      await this.cleanupExpiredUpdates();
      
      // 2. 检查存储用量
      let usage = 0;
      let quota = 500 * 1024 * 1024; // 默认 500MB
      
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          usage = estimate.usage || 0;
          quota = estimate.quota || quota;
        } catch (error) {
          console.warn('Failed to get storage estimate:', error);
        }
      }
      
      // 3. 如果使用量超过 80%，清理更多数据
      const usageRatio = usage / quota;
      if (usageRatio > 0.8) {
        console.log(`Storage usage is high (${(usageRatio * 100).toFixed(1)}%), cleaning up expired data`);
        
        // 清理过期文档（超过30天未访问）
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        await this.db.table('documents')
          .where('lastAccessedAt').below(thirtyDaysAgo)
          .delete();
      }
    } catch (error) {
      console.error('Cache cleanup failed:', error);
    }
  }

  // 清理指定文档的所有更新
  async clearUpdates(docId: string): Promise<void> {
    await this.db.table('syncUpdates')
      .where('docId').equals(docId)
      .delete();
  }

  // 删除文档及其关联数据
  async deleteDoc(docId: string): Promise<void> {
    // 1. 删除文档本身
    await this.db.table('documents')
      .where('id').equals(docId)
      .delete();
    
    // 2. 删除关联的同步更新记录
    await this.db.table('syncUpdates')
      .where('docId').equals(docId)
      .delete();
  }
}

/**
 * 创建 Web 本地存储实例
 */
export function createWebLocalDB(): LocalDB {
  return new WebLocalDB();
}
