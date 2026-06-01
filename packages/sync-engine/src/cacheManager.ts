/**
 * 客户端缓存管理器
 * 
 * 用途：
 * - 管理客户端文档和快照的缓存
 * - 实现LRU缓存策略
 * - 控制缓存大小和清理策略
 * 
 * 输入：缓存配置、文档数据
 * 输出：缓存管理结果
 */

import { createLogger } from "@inkweaver/shared";

interface CacheConfig {
  maxCacheSize: number; // 最大缓存大小（字节）
  maxDocuments: number; // 最大文档数量
  cleanupThreshold: number; // 清理阈值（百分比）
  ttl: number; // 缓存生存时间（毫秒）
}

interface CacheEntry {
  docId: string;
  snapshot: Uint8Array;
  lastUpdateId: number;
  lastAccessTime: number;
  size: number;
  accessCount: number;
  createdAt: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry>();
  private totalSize = 0;
  private logger = createLogger({ scope: "cache-manager" });

  constructor(private config: CacheConfig = {
    maxCacheSize: 200 * 1024 * 1024, // 200MB
    maxDocuments: 50,
    cleanupThreshold: 0.8, // 80%
    ttl: 24 * 60 * 60 * 1000, // 24小时
  }) {}

  /**
   * 添加文档到缓存
   */
  set(docId: string, snapshot: Uint8Array, lastUpdateId: number): void {
    const size = snapshot.byteLength;
    
    // 检查是否需要清理缓存
    if (this.shouldCleanup(size)) {
      this.cleanup();
    }

    const entry: CacheEntry = {
      docId,
      snapshot,
      lastUpdateId,
      lastAccessTime: Date.now(),
      size,
      accessCount: 1,
      createdAt: Date.now(),
    };

    // 如果文档已存在，先移除旧缓存
    if (this.cache.has(docId)) {
      const oldEntry = this.cache.get(docId)!;
      this.totalSize -= oldEntry.size;
    }

    this.cache.set(docId, entry);
    this.totalSize += size;

    this.logger.debug(`Cache set: ${docId}, size: ${this.formatSize(size)}, total: ${this.formatSize(this.totalSize)}`);
  }

  /**
   * 从缓存获取文档
   */
  get(docId: string): CacheEntry | null {
    const entry = this.cache.get(docId);
    
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (this.isExpired(entry)) {
      this.remove(docId);
      return null;
    }

    // 更新访问信息
    entry.lastAccessTime = Date.now();
    entry.accessCount++;

    return entry;
  }

  /**
   * 从缓存移除文档
   */
  remove(docId: string): boolean {
    const entry = this.cache.get(docId);
    
    if (entry) {
      this.totalSize -= entry.size;
      this.cache.delete(docId);
      
      this.logger.debug(`Cache removed: ${docId}, total: ${this.formatSize(this.totalSize)}`);
      return true;
    }
    
    return false;
  }

  /**
   * 检查是否需要清理缓存
   */
  private shouldCleanup(newSize: number): boolean {
    const projectedSize = this.totalSize + newSize;
    
    return (
      this.cache.size >= this.config.maxDocuments ||
      projectedSize >= this.config.maxCacheSize * this.config.cleanupThreshold
    );
  }

  /**
   * 清理缓存（LRU策略）
   */
  private cleanup(): void {
    const entries = Array.from(this.cache.values());
    
    // 按访问时间和频率排序（LRU）
    entries.sort((a, b) => {
      // 优先清理长时间未访问的
      if (a.lastAccessTime !== b.lastAccessTime) {
        return a.lastAccessTime - b.lastAccessTime;
      }
      // 其次清理访问次数少的
      return a.accessCount - b.accessCount;
    });

    let removedCount = 0;
    let removedSize = 0;
    
    // 清理直到满足条件
    while (
      (this.cache.size >= this.config.maxDocuments || 
       this.totalSize >= this.config.maxCacheSize * this.config.cleanupThreshold) &&
      entries.length > 0
    ) {
      const entry = entries.shift()!;
      this.remove(entry.docId);
      removedCount++;
      removedSize += entry.size;
    }

    if (removedCount > 0) {
      this.logger.info(`Cache cleanup: removed ${removedCount} entries, freed ${this.formatSize(removedSize)}`);
    }
  }

  /**
   * 检查缓存条目是否过期
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.lastAccessTime > this.config.ttl;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      totalDocuments: this.cache.size,
      totalSize: this.totalSize,
      formattedSize: this.formatSize(this.totalSize),
      maxDocuments: this.config.maxDocuments,
      maxSize: this.config.maxCacheSize,
      formattedMaxSize: this.formatSize(this.config.maxCacheSize),
    };
  }

  /**
   * 清理所有缓存
   */
  clear(): void {
    const count = this.cache.size;
    const size = this.totalSize;
    
    this.cache.clear();
    this.totalSize = 0;
    
    this.logger.info(`Cache cleared: ${count} entries, ${this.formatSize(size)}`);
  }

  /**
   * 定期清理过期缓存
   */
  cleanupExpired(): number {
    const expiredEntries = Array.from(this.cache.values()).filter(entry => this.isExpired(entry));
    
    expiredEntries.forEach(entry => {
      this.remove(entry.docId);
    });

    if (expiredEntries.length > 0) {
      this.logger.info(`Cleaned up ${expiredEntries.length} expired cache entries`);
    }

    return expiredEntries.length;
  }

  /**
   * 获取最常访问的文档
   */
  getMostAccessed(limit: number = 10): CacheEntry[] {
    return Array.from(this.cache.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  /**
   * 获取最近访问的文档
   */
  getRecentlyAccessed(limit: number = 10): CacheEntry[] {
    return Array.from(this.cache.values())
      .sort((a, b) => b.lastAccessTime - a.lastAccessTime)
      .slice(0, limit);
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * 更新缓存配置
   */
  updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // 如果新配置更严格，立即清理
    if (
      newConfig.maxCacheSize && newConfig.maxCacheSize < this.config.maxCacheSize ||
      newConfig.maxDocuments && newConfig.maxDocuments < this.config.maxDocuments
    ) {
      this.cleanup();
    }
    
    this.logger.info('Cache config updated', this.config);
  }
}