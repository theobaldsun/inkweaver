/**
 * 用户存储用量类型定义（跨端共享）。
 *
 * 用途：统一服务端与客户端的存储统计响应结构。
 */

/** 默认存储配额：10 GB */
export const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

/** 服务端缓存视为过期的时长（毫秒） */
export const STORAGE_USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 用户存储使用统计（标准格式）。
 */
export interface UserStorageUsage {
  /** 已用字节数（文档 + 同步数据） */
  usedBytes: number;
  /** 配额字节数 */
  quotaBytes: number;
  /** 文档数量 */
  documentCount: number;
  /** 文件夹数量 */
  folderCount: number;
  /** Yjs 快照与同步更新占用字节 */
  syncDataBytes: number;
  /** 文档正文与标题占用字节 */
  documentDataBytes: number;
  /** 使用率 0–100 */
  usagePercent: number;
  /** 服务端统计更新时间 ISO 8601 */
  lastUpdatedAt: string;
  /** 是否为强制重算后的结果 */
  recalculated?: boolean;
  /** 计算失败时返回缓存且标记为可能过期 */
  stale?: boolean;
  /** 错误信息（仅客户端拉取失败时） */
  error?: string;
}

/**
 * 兼容旧版 API 字段的存储统计。
 * @deprecated 请使用 UserStorageUsage 的 usedBytes / quotaBytes
 */
export interface StorageStatsLegacy {
  documentCount: number;
  usedStorage: number;
  totalStorage: number;
}
