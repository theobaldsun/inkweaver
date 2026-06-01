/**
 * 存储容量工具函数（跨端共享）。
 */

import type { UserStorageUsage } from '../types/storage';
import { DEFAULT_STORAGE_QUOTA_BYTES } from '../types/storage';

/**
 * 计算 UTF-8 字符串字节长度。
 * @param value 文本
 * @returns 字节数
 */
export function calculateUtf8ByteSize(value: string | null | undefined): number {
  if (!value) return 0;
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value, 'utf8');
  }
  return value.length;
}

/**
 * 计算使用率百分比（0–100，保留两位小数）。
 */
export function getStorageUsagePercent(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  const percent = (usedBytes / quotaBytes) * 100;
  return Math.min(100, Math.round(percent * 100) / 100);
}

/**
 * 将字节格式化为人类可读单位。
 */
export function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);

  return `${parseFloat(value.toFixed(i === 0 ? 0 : 2))} ${sizes[i]}`;
}

/**
 * 将服务端或旧版响应规范化为 UserStorageUsage。
 */
export function normalizeUserStorageUsage(
  raw: Partial<UserStorageUsage> & Partial<{ usedStorage: number; totalStorage: number }>,
): UserStorageUsage {
  const usedBytes = raw.usedBytes ?? raw.usedStorage ?? 0;
  const quotaBytes = raw.quotaBytes ?? raw.totalStorage ?? DEFAULT_STORAGE_QUOTA_BYTES;
  const documentDataBytes = raw.documentDataBytes ?? usedBytes;
  const syncDataBytes = raw.syncDataBytes ?? 0;

  return {
    usedBytes,
    quotaBytes,
    documentCount: raw.documentCount ?? 0,
    folderCount: raw.folderCount ?? 0,
    syncDataBytes,
    documentDataBytes,
    usagePercent: raw.usagePercent ?? getStorageUsagePercent(usedBytes, quotaBytes),
    lastUpdatedAt: raw.lastUpdatedAt ?? new Date().toISOString(),
    recalculated: raw.recalculated,
    stale: raw.stale,
    error: raw.error,
  };
}
