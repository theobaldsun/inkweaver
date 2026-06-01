import type { Document, SyncUpdate } from '@inkweaver/shared';

/**
 * 本地存储统一接口
 */
export interface LocalDB {
  /**
   * 保存文档
   */
  saveDoc(doc: Document): Promise<void>;
  
  /**
   * 获取文档
   */
  getDoc(id: string): Promise<Document>;
  
  /**
   * 保存同步更新
   */
  saveUpdate(update: SyncUpdate): Promise<void>;
  
  /**
   * 获取指定时间戳之后的更新
   */
  getUpdatesSince(docId: string, since: number): Promise<SyncUpdate[]>;
  
  /**
   * 获取待同步的更新
   */
  getPendingUpdates(docId: string): Promise<SyncUpdate[]>;
  
  /**
   * 清除待同步的更新
   */
  clearPending(docId: string): Promise<void>;
  
  /**
   * 清理缓存
   */
  cleanupCache?(): Promise<void>;
  
  /**
   * 清理指定文档的所有更新
   */
  clearUpdates?(docId: string): Promise<void>;
  
  /**
   * 分页获取待同步的更新
   */
  getPendingUpdatesBatch?(docId: string, limit: number): Promise<SyncUpdate[]>;
  
  /**
   * 根据 id 列表批量删除记录
   */
  clearPendingBatch?(docId: string, ids: number[]): Promise<void>;

  /**
   * 获取所有文档（用于恢复临时文档）
   */
  getAllDocuments?(): Promise<Document[]>;
  /**
   * 删除文档及其关联数据
   */
  deleteDoc?(id: string): Promise<void>;
}

// 导出平台特定实现
export * from './web';
export * from './native';
