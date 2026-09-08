/**
 * 存储用量 API 客户端。
 *
 * 用途：从服务端获取标准化存储统计。
 */

import { normalizeUserStorageUsage } from '@inkweaver/shared';

import { apiClient } from '../client';

import type { UserStorageUsage } from '@inkweaver/shared';

export interface GetStorageUsageOptions {
  /** 强制服务端重新聚合计算 */
  recalculate?: boolean;
}

export const storageApi = {
  /**
   * 获取当前用户存储用量（标准格式）。
   */
  async getUsage(options?: GetStorageUsageOptions): Promise<UserStorageUsage> {
    const query = options?.recalculate ? '?recalculate=true' : '';
    const data = (await apiClient.get(`/storage/usage${query}`)) as UserStorageUsage;
    return normalizeUserStorageUsage(data);
  },

  /**
   * 上传文档内嵌图片等资源。
   * @returns 相对 URL，如 /uploads/assets/{userId}/{file}
   */
  async uploadAsset(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/storage/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as Promise<{ url: string }>;
  },
};
