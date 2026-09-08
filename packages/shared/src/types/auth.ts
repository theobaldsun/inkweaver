/**
 * 认证相关的类型定义
 */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** 当前登录会话 ID，用于设备管理页标记「当前设备」 */
  sessionId?: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface CheckSessionRequest {
  userId: string;
  refresh_token: string;
}

export interface CheckSessionResponse {
  isValid: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

/** 用户偏好设置 */
export interface UserSettings {
  emailNotifications: boolean;
  browserNotifications: boolean;
  docUpdateNotifications: boolean;
  showOnlineStatus: boolean;
  allowDocSharing: boolean;
  editorFontFamily: string;
  editorFontSize: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  settings?: UserSettings;
  createdAt?: string;
  updatedAt?: string;
}

/** 用户会话摘要（设备管理） */
export interface UserSessionInfo {
  id: string;
  deviceType?: string | null;
  deviceName?: string | null;
  os?: string | null;
  browser?: string | null;
  ipAddress?: string | null;
  lastActivityAt: string;
  createdAt: string;
  isCurrent?: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  userId: string;
  user: User;
}

export interface AuthError {
  code: string;
  message: string;
  details?: unknown;
}
