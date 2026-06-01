import { authApi, setStorageAdapter as setApiStorageAdapter, getStorageAdapter as getApiStorageAdapter, type StorageAdapter } from '@inkweaver/api';
import type { LoginRequest, RegisterRequest, LoginResponse } from '@inkweaver/shared';

const TOKENS_KEY = 'syncbox_auth_tokens';
const REMEMBER_ME_KEY = 'syncbox_remember_me';

export function setStorageAdapter(storage: StorageAdapter): void {
  setApiStorageAdapter(storage);
}

export function getStorageAdapter(): StorageAdapter {
  return getApiStorageAdapter();
}

export const authService = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await authApi.login(data);
    return response;
  },

  async register(data: RegisterRequest): Promise<LoginResponse> {
    const response = await authApi.register(data);
    return response;
  },

  async thirdPartyLogin(provider: string, code: string): Promise<LoginResponse> {
    const response = await authApi.thirdPartyLogin(provider, code);
    return response;
  },

  async saveTokens(tokens: LoginResponse, userId: string): Promise<void> {
    try {
      const storage = getApiStorageAdapter();
      await storage.setItem(TOKENS_KEY, JSON.stringify({
        ...tokens,
        userId,
      }));
    } catch (error) {
      console.error('保存令牌失败:', error);
    }
  },

  async saveRememberMe(remember: boolean): Promise<void> {
    try {
      const storage = getApiStorageAdapter();
      if (remember) {
        await storage.setItem(REMEMBER_ME_KEY, 'true');
      } else {
        await storage.removeItem(REMEMBER_ME_KEY);
      }
    } catch (error) {
      console.error('保存记住我状态失败:', error);
    }
  },

  async getTokens(): Promise<(LoginResponse & { userId: string }) | null> {
    try {
      const storage = getApiStorageAdapter();
      const tokens = await storage.getItem(TOKENS_KEY);
      return tokens ? JSON.parse(tokens) : null;
    } catch (error) {
      console.error('获取令牌失败:', error);
      return null;
    }
  },

  async clearTokens(): Promise<void> {
    try {
      const storage = getApiStorageAdapter();
      await storage.removeItem(TOKENS_KEY);
      await storage.removeItem(REMEMBER_ME_KEY);
    } catch (error) {
      console.error('清除令牌失败:', error);
    }
  },

  async isLoggedIn(): Promise<boolean> {
    const tokens = await this.getTokens();
    return !!tokens;
  },

  async logout(): Promise<void> {
    await authApi.logout();
    await this.clearTokens();
  },
};