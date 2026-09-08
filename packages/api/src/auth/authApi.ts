/**
 * 认证相关的 API 接口
 */

import { hashPasswordForTransport } from '@inkweaver/shared';

import { apiClient } from '../client';

import type { LoginRequest, RegisterRequest, LoginResponse, RefreshTokenRequest, RefreshTokenResponse, CheckSessionRequest, CheckSessionResponse } from '@inkweaver/shared';

/**
 * 认证 API 接口
 */
export const authApi = {
  /**
   * 用户登录
   * @param data 登录数据
   * @returns 登录响应
   */
  async login(data: LoginRequest): Promise<LoginResponse> {
    const passwordHash = await hashPasswordForTransport(data.password);
    return apiClient.post('/users/login', { email: data.email, passwordHash });
  },

  /**
   * 用户注册
   * @param data 注册数据
   * @returns 注册响应
   */
  async register(data: RegisterRequest): Promise<LoginResponse> {
    const passwordHash = await hashPasswordForTransport(data.password);
    return apiClient.post('/users/register', {
      email: data.email,
      passwordHash,
      name: data.name,
    });
  },

  /**
   * 第三方登录
   * @param provider 第三方提供商
   * @param code 授权码
   * @returns 登录响应
   */
  async thirdPartyLogin(provider: string, code: string): Promise<LoginResponse> {
    return apiClient.post('/auth/third-party', { provider, code });
  },

  /**
   * 刷新令牌
   * @param data 刷新令牌数据
   * @returns 刷新令牌响应
   */
  async refreshToken(data: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    return apiClient.post('/auth/refresh', data);
  },

  /**
   * 检查会话
   * @param data 检查会话数据
   * @returns 检查会话响应
   */
  async checkSession(data: CheckSessionRequest): Promise<CheckSessionResponse> {
    return apiClient.post('/auth/check-session', data);
  },

  /**
   * 退出登录
   * @param data 可选：refresh_token 与 userId，用于撤销服务端会话
   */
  async logout(data?: { refresh_token?: string; userId?: string }): Promise<{ message: string }> {
    return apiClient.post('/auth/logout', data ?? {});
  },

  /**
   * 忘记密码：发送重置邮件（统一成功文案，防枚举）
   */
  async forgotPassword(email: string): Promise<{ message: string; success: boolean }> {
    return apiClient.post('/auth/forgot-password', { email });
  },

  /**
   * 通过邮件链接重置密码
   */
  async resetPassword(
    token: string,
    password: string,
  ): Promise<{ message: string; success: boolean }> {
    const passwordHash = await hashPasswordForTransport(password);
    return apiClient.post('/auth/reset-password', { token, passwordHash });
  },
};
