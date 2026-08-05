/**
 * API 包导出
 */

export {
  apiClient,
  createApiClient,
  setStorageAdapter,
  getStorageAdapter,
  getApiErrorMessage,
} from './client';
export type { StorageAdapter, ApiClientOptions } from './client';
export * from './auth/authApi';
export * from './documents/documentApi';
export * from './documents/folderApi';
export * from './users/userApi';
export * from './storage/storageApi';
export * from './search/searchApi';
export * from './notifications/notificationApi';
export * from './ai/aiApi';
