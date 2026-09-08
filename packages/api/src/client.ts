/**
 * API 基础配置
 * 平台无关的核心API客户端
 */

import axios, { isAxiosError } from 'axios';

import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// 定义存储适配器接口
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Web 可选能力：在持久化和标签页会话存储之间迁移认证状态。 */
  setPersistence?(persistent: boolean): Promise<void>;
}

const TOKENS_KEY = 'syncbox_auth_tokens';

// 当前存储适配器（用于全局共享）
let currentStorage: StorageAdapter = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

/**
 * 设置全局存储适配器
 * @param storage 存储适配器
 */
export function setStorageAdapter(storage: StorageAdapter): void {
  currentStorage = storage;
}

/**
 * 获取当前存储适配器
 * @returns 存储适配器
 */
export function getStorageAdapter(): StorageAdapter {
  return currentStorage;
}

// API客户端配置选项
export interface ApiClientOptions {
  baseURL?: string;
  timeout?: number;
}

// 运行时配置。浏览器默认走同源反向代理，避免生产产物绑定访问者本机端口。
let runtimeConfig: Required<ApiClientOptions> = {
  baseURL: '/api',
  timeout: 10000,
};

/** 无需携带 token、401 时不应跳转登录页的公开认证接口 */
const PUBLIC_AUTH_PATHS = [
  '/users/login',
  '/users/register',
  '/auth/refresh',
  '/auth/check-session',
  '/auth/forgot-password',
  '/auth/reset-password',
];

/**
 * 是否为公开登录/注册请求（失败时不触发全局登出跳转）。
 * @param config axios 请求配置
 */
function isPublicAuthRequest(config?: AxiosRequestConfig): boolean {
  const url = config?.url ?? '';
  return PUBLIC_AUTH_PATHS.some((path) => url.includes(path));
}

/**
 * 当前是否已在登录页（避免 401 时重复整页刷新）。
 */
function isOnLoginPage(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const path = window.location.pathname;
  return path === '/login' || path.endsWith('/login');
}

/**
 * 从 axios / 业务错误中提取可展示文案。
 * @param error 捕获的异常
 * @param fallback 默认文案
 */
export function getApiErrorMessage(error: unknown, fallback = '请求失败'): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (typeof data?.message === 'string' && data.message.trim()) {
      return data.message;
    }
    if (Array.isArray(data?.message) && data.message.length > 0) {
      return data.message.join('，');
    }
    if (error.response?.status === 401) {
      return '邮箱或密码错误';
    }
    if (error.response?.status === 400) {
      return '请求参数有误，请检查后重试';
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  userId: string;
  user?: { id: string; email: string; name: string };
}

/**
 * 模块级共享刷新状态（所有 axios 实例共用，防止多实例同时刷新 token 导致竞态）。
 *
 * 背景：同一个共享实例也可能同时收到多个 401。若每个请求独立刷新，第二次刷新
 * 会因为 refresh token rotation 已消费旧令牌而失败。
 *
 * 解决方案：将刷新锁和等待队列提升为模块级变量，所有实例共享同一刷新流程。
 */
let sharedIsRefreshing = false;
let sharedRefreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

/**
 * 创建API客户端工厂函数
 * @param options 配置选项
 * @returns axios实例
 */
export function createApiClient(options: { baseURL?: string; timeout?: number } = {}): AxiosInstance {
  const config = { ...runtimeConfig, ...options };

  /**
   * 处理共享刷新队列：将结果分发给所有等待中的请求，然后清空队列。
   * 所有并发请求共用同一队列，确保一轮 401 只消费一次 refresh token。
   */
  const processRefreshQueue = (error: unknown | null, token: string | null = null) => {
    sharedRefreshQueue.forEach(({ resolve, reject }) => {
      if (error || !token) {
        reject(error ?? new Error('刷新令牌失败'));
      } else {
        resolve(token);
      }
    });
    sharedRefreshQueue = [];
  };

  const refreshAccessToken = async (): Promise<string> => {
    const tokensStr = await currentStorage.getItem(TOKENS_KEY);
    if (!tokensStr) {
      throw new Error('无可用刷新令牌');
    }

    const tokens = JSON.parse(tokensStr) as StoredTokens;
    if (!tokens.refresh_token) {
      throw new Error('无可用刷新令牌');
    }

    const response = await axios.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>(
      `${runtimeConfig.baseURL}/auth/refresh`,
      { refresh_token: tokens.refresh_token },
      { timeout: config.timeout },
    );

    const updated: StoredTokens = {
      ...tokens,
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
    };
    await currentStorage.setItem(TOKENS_KEY, JSON.stringify(updated));
    return updated.access_token;
  };

  // 创建axios实例
  const apiClient = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // 请求拦截器
  apiClient.interceptors.request.use(
    async (axiosConfig: InternalAxiosRequestConfig) => {
      try {
        const tokensStr = await currentStorage.getItem(TOKENS_KEY);
        if (tokensStr) {
          const tokens = JSON.parse(tokensStr);
          if (tokens.access_token) {
            axiosConfig.headers.Authorization = `Bearer ${tokens.access_token}`;
          }
        }
      } catch (error) {
        console.error('Error getting token from storage:', error);
      }
      return axiosConfig;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // 响应拦截器
  apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
      return response.data;
    },
    async (error) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      if (
        error.response?.status === 401 &&
        originalRequest &&
        !originalRequest._retry &&
        !isPublicAuthRequest(originalRequest)
      ) {
        if (sharedIsRefreshing) {
          return new Promise((resolve, reject) => {
            sharedRefreshQueue.push({
              resolve: (token: string) => {
                originalRequest.headers.Authorization = `Bearer ${token}`;
                originalRequest._retry = true;
                resolve(apiClient(originalRequest));
              },
              reject,
            });
          });
        }

        originalRequest._retry = true;
        sharedIsRefreshing = true;

        try {
          const newToken = await refreshAccessToken();
          processRefreshQueue(null, newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        } catch (refreshError) {
          processRefreshQueue(refreshError, null);
          const skipRedirect = isOnLoginPage();
          if (!skipRedirect) {
            try {
              await currentStorage.removeItem(TOKENS_KEY);
              if (typeof window !== 'undefined') {
                window.location.href = '/login';
              }
            } catch {
              // 非浏览器环境忽略
            }
          }
        } finally {
          sharedIsRefreshing = false;
        }
      } else if (error.response?.status === 401) {
        const skipRedirect =
          isPublicAuthRequest(error.config) || isOnLoginPage();
        if (!skipRedirect) {
          try {
            await currentStorage.removeItem(TOKENS_KEY);
            if (typeof window !== 'undefined') {
              window.location.href = '/login';
            }
          } catch {
            // 非浏览器环境忽略
          }
        }
      }

      const message = getApiErrorMessage(error);
      if (error instanceof Error) {
        error.message = message;
      }
      return Promise.reject(error);
    }
  );

  return apiClient;
}

export const apiClient = createApiClient();

/**
 * 配置共享 API Client。
 *
 * 所有业务 API 都引用同一个实例；这里同时更新运行时配置，使 401 自动刷新也使用
 * 与普通请求一致的 baseURL，而不是模块加载时捕获的默认地址。
 */
export function configureApiClient(options: ApiClientOptions): void {
  runtimeConfig = { ...runtimeConfig, ...options };
  apiClient.defaults.baseURL = runtimeConfig.baseURL;
  apiClient.defaults.timeout = runtimeConfig.timeout;
}
