/**
 * Web端存储适配器
 * 根据「记住我」选择 localStorage 或 sessionStorage。
 */

import type { StorageAdapter } from '@inkweaver/api';

/**
 * Web 认证存储适配器。
 * `syncbox_remember_me=true` 固定保存在 localStorage，其他认证项跟随选择迁移。
 */
const REMEMBER_ME_KEY = 'syncbox_remember_me';
const TOKENS_KEY = 'syncbox_auth_tokens';

function selectedStorage(): Storage {
  return localStorage.getItem(REMEMBER_ME_KEY) === 'true' ? localStorage : sessionStorage;
}

export const webStorageAdapter: StorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (key === REMEMBER_ME_KEY) return localStorage.getItem(key);
      const selected = selectedStorage().getItem(key);
      if (selected !== null) return selected;

      // 兼容升级前始终写 localStorage 的令牌，首次读取后继续按持久会话处理。
      const legacy = localStorage.getItem(key);
      if (key === TOKENS_KEY && legacy !== null) {
        localStorage.setItem(REMEMBER_ME_KEY, 'true');
      }
      return legacy;
    } catch (error) {
      console.error('Error getting item from localStorage:', error);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (key === REMEMBER_ME_KEY) {
        localStorage.setItem(key, value);
      } else {
        selectedStorage().setItem(key, value);
      }
    } catch (error) {
      console.error('Error setting item to localStorage:', error);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing item from localStorage:', error);
    }
  },

  setPersistence: async (persistent: boolean): Promise<void> => {
    const tokenValue = sessionStorage.getItem(TOKENS_KEY) ?? localStorage.getItem(TOKENS_KEY);
    localStorage.removeItem(TOKENS_KEY);
    sessionStorage.removeItem(TOKENS_KEY);
    if (persistent) {
      localStorage.setItem(REMEMBER_ME_KEY, 'true');
      if (tokenValue !== null) localStorage.setItem(TOKENS_KEY, tokenValue);
    } else {
      localStorage.removeItem(REMEMBER_ME_KEY);
      if (tokenValue !== null) sessionStorage.setItem(TOKENS_KEY, tokenValue);
    }
  },
};

export default webStorageAdapter;
