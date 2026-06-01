/**
 * shared 包入口。
 *
 * 用途：
 * - 放置跨端共享的：类型、工具函数、错误定义、日志、配置约定等
 * - 作为"黑盒"基础设施包，供 apps 与其他 packages 依赖
 *
 * 输入：来自调用方的参数
 * 输出：工具函数返回值/类型定义
 */

export type { Logger, LoggerLevel, LoggerOptions } from "./logger";
export { createLogger } from "./logger";

// 导出认证相关类型
export type {
  LoginRequest,
  RegisterRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  CheckSessionRequest,
  CheckSessionResponse,
  User,
  UserSettings,
  UserSessionInfo,
  AuthTokens,
  AuthError,
} from "./types/auth";
export { DEFAULT_USER_SETTINGS, mergeUserSettings } from "./constants/userSettings";

// 导出文档相关类型
export { TRASH_RETENTION_DAYS } from "./types/document";
export type {
  Document,
  Folder,
  SyncUpdate,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  CreateFolderRequest,
  UpdateFolderRequest,
  DocumentResponse,
  DocumentListResponse,
  DocumentError,
} from "./types/document";

// 导出存储相关类型与工具
export type { UserStorageUsage, StorageStatsLegacy } from "./types/storage";
export {
  DEFAULT_STORAGE_QUOTA_BYTES,
  STORAGE_USAGE_CACHE_TTL_MS,
} from "./types/storage";
export {
  calculateUtf8ByteSize,
  formatStorageSize,
  getStorageUsagePercent,
  normalizeUserStorageUsage,
} from "./utils/storage";

// 导出工具函数
export {
  hashPasswordForTransport,
  isPasswordDigest,
  PASSWORD_DIGEST_REGEX,
} from "./crypto/passwordDigest";

export { createPushThrottle } from './utils/pushThrottle';

export {
  base64ToUint8Array,
  uint8ArrayToBase64,
  base64ArrayToUint8ArrayArray,
  uint8ArrayArrayToBase64Array,
  isValidBase64,
  getBase64ByteSize,
  createBase64Converter,
  base64Converter,
} from "./utils/base64";

