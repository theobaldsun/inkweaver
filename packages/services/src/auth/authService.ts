/**
 * 认证服务
 * 处理认证相关的业务逻辑
 */

import { authApi, setStorageAdapter as setApiStorageAdapter, getStorageAdapter as getApiStorageAdapter, type StorageAdapter } from '@inkweaver/api';

import type { LoginRequest, RegisterRequest, LoginResponse } from '@inkweaver/shared';

const TOKENS_KEY = 'syncbox_auth_tokens';
const REMEMBER_ME_KEY = 'syncbox_remember_me';

/**
 * 设置存储适配器
 * @param storage 存储适配器
 */
export function setStorageAdapter(storage: StorageAdapter): void {
  setApiStorageAdapter(storage);
}

/**
 * 获取当前存储适配器
 * @returns 存储适配器
 */
export function getStorageAdapter(): StorageAdapter {
  return getApiStorageAdapter();
}

/**
 * 认证服务
 */
export const authService = {
  /**
   * 用户登录
   * @param data 登录数据
   * @returns 登录响应
   */
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await authApi.login(data);
    return response;
  },

  /**
   * 用户注册
   * @param data 注册数据
   * @returns 注册响应
   */
  async register(data: RegisterRequest): Promise<LoginResponse> {
    const response = await authApi.register(data);
    return response;
  },

  /**
   * 第三方登录
   * @param provider 第三方提供商
   * @param code 授权码
   * @returns 登录响应
   */
  async thirdPartyLogin(provider: string, code: string): Promise<LoginResponse> {
    const response = await authApi.thirdPartyLogin(provider, code);
    return response;
  },

  /**
   * 保存认证令牌
   * @param tokens 认证令牌
   * @param userId 用户 ID
   */
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

  /**
   * 保存记住我状态
   * @param remember 是否记住
   */
  async saveRememberMe(remember: boolean): Promise<void> {
    try {
      const storage = getApiStorageAdapter();
      await storage.setPersistence?.(remember);
      if (remember) {
        await storage.setItem(REMEMBER_ME_KEY, 'true');
      } else {
        await storage.removeItem(REMEMBER_ME_KEY);
      }
    } catch (error) {
      console.error('保存记住我状态失败:', error);
    }
  },

  /**
   * 获取认证令牌
   * @returns 认证令牌
   */
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

  /**
   * 清除认证令牌
   */
  async clearTokens(): Promise<void> {
    try {
      const storage = getApiStorageAdapter();
      await storage.removeItem(TOKENS_KEY);
      await storage.removeItem(REMEMBER_ME_KEY);
    } catch (error) {
      console.error('清除令牌失败:', error);
    }
  },

  /**
   * 检查是否已登录
   * @returns 是否已登录
   */
  async isLoggedIn(): Promise<boolean> {
    const tokens = await this.getTokens();
    return !!tokens;
  },

  /**
   * 是否勾选「记住我」
   */
  async getRememberMe(): Promise<boolean> {
    try {
      const storage = getApiStorageAdapter();
      const value = await storage.getItem(REMEMBER_ME_KEY);
      return value === 'true';
    } catch {
      return false;
    }
  },

  /**
   * 启动时校验会话：有效则刷新 access_token，无效则清除本地令牌。
   */
  async ensureSession(): Promise<boolean> {
    const tokens = await this.getTokens();
    if (!tokens?.refresh_token || !tokens.userId) {
      return false;
    }

    try {
      const result = await authApi.checkSession({
        userId: tokens.userId,
        refresh_token: tokens.refresh_token,
      });

      if (!result.isValid) {
        await this.clearTokens();
        return false;
      }

      if (result.access_token) {
        await this.saveTokens(
          {
            access_token: result.access_token,
            refresh_token: result.refresh_token ?? tokens.refresh_token,
            expires_in: result.expires_in ?? tokens.expires_in,
            user: result.user ?? tokens.user ?? {
              id: tokens.userId,
              email: '',
              name: '',
            },
          },
          tokens.userId,
        );
      }

      return true;
    } catch (error) {
      console.error('会话校验失败:', error);
      await this.clearTokens();
      return false;
    }
  },

  /**
   * 退出登录（尽力撤销服务端会话，并始终清除本地令牌）
   */
  async logout(): Promise<void> {
    try {
      const tokens = await this.getTokens();
      if (tokens?.refresh_token && tokens?.userId) {
        await authApi.logout({
          refresh_token: tokens.refresh_token,
          userId: tokens.userId,
        });
      } else {
        await authApi.logout();
      }
    } catch (error) {
      console.error('退出登录请求失败:', error);
    } finally {
      await this.clearTokens();
    }
  },
};
