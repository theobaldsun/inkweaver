/**
 * 存储用量业务服务（跨端）。
 *
 * 用途：封装 API 调用、格式化与轮询辅助。
 */

import { storageApi, type GetStorageUsageOptions } from '@inkweaver/api';
import type { UserStorageUsage } from '@inkweaver/shared';
import {
  formatStorageSize,
  normalizeUserStorageUsage,
  STORAGE_USAGE_CACHE_TTL_MS,
} from '@inkweaver/shared';

let cachedUsage: UserStorageUsage | null = null;
let cachedAt = 0;

/** 文档变更后使客户端缓存失效（各端在保存笔记后可选调用） */
export function invalidateStorageUsageCache(): void {
  cachedUsage = null;
  cachedAt = 0;
}

export const storageService = {
  invalidateCache: invalidateStorageUsageCache,
  /**
   * 获取存储用量；默认使用短期客户端缓存减少请求。
   */
  async getUsage(options?: GetStorageUsageOptions & { skipCache?: boolean }): Promise<UserStorageUsage> {
    const now = Date.now();
    if (
      !options?.recalculate &&
      !options?.skipCache &&
      cachedUsage &&
      now - cachedAt < STORAGE_USAGE_CACHE_TTL_MS
    ) {
      return cachedUsage;
    }

    try {
      const usage = await storageApi.getUsage({ recalculate: options?.recalculate });
      cachedUsage = usage;
      cachedAt = now;
      return usage;
    } catch (error) {
      if (cachedUsage) {
        return {
          ...cachedUsage,
          stale: true,
          error: error instanceof Error ? error.message : '网络错误，显示缓存数据',
        };
      }
      throw error;
    }
  },

  /** 强制刷新并清除客户端缓存 */
  async refreshUsage(): Promise<UserStorageUsage> {
    cachedUsage = null;
    cachedAt = 0;
    return this.getUsage({ recalculate: true, skipCache: true });
  },

  clearClientCache(): void {
    cachedUsage = null;
    cachedAt = 0;
  },

  formatStorageSize,

  normalizeUserStorageUsage,
};
