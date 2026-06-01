/**
 * 存储用量拉取与轮询 Hook。
 *
 * 用途：各端 Profile/设置页复用，保持与服务端数据同步。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { storageService } from '@inkweaver/services';
import type { UserStorageUsage } from '@inkweaver/shared';

export interface UseStorageUsageOptions {
  /** 自动轮询间隔（毫秒），0 表示不轮询 */
  pollIntervalMs?: number;
  /** 挂载时是否立即拉取 */
  enabled?: boolean;
}

export interface UseStorageUsageResult {
  usage: UserStorageUsage | null;
  loading: boolean;
  error: string | null;
  refresh: (recalculate?: boolean) => Promise<void>;
}

/**
 * 获取并同步用户存储用量。
 */
export function useStorageUsage(options: UseStorageUsageOptions = {}): UseStorageUsageResult {
  const { pollIntervalMs = 60_000, enabled = true } = options;
  const [usage, setUsage] = useState<UserStorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (recalculate = false) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = recalculate
        ? await storageService.refreshUsage()
        : await storageService.getUsage({ skipCache: recalculate });
      if (mountedRef.current) {
        setUsage(data);
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : '无法获取存储信息，请检查网络');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      void refresh(false);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return undefined;
    const id = setInterval(() => {
      void refresh(false);
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [enabled, pollIntervalMs, refresh]);

  return { usage, loading, error, refresh };
}
