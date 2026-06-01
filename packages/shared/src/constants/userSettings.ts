/**
 * 用户偏好设置默认值（跨端共享）。
 */

import type { UserSettings } from '../types/auth';

/** 默认用户偏好 */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  emailNotifications: true,
  browserNotifications: true,
  docUpdateNotifications: false,
  showOnlineStatus: false,
  allowDocSharing: true,
  editorFontFamily: '微软雅黑',
  editorFontSize: '16px',
};

/**
 * 合并用户设置与默认值。
 * @param partial 数据库或请求中的部分设置
 */
export function mergeUserSettings(partial?: Partial<UserSettings> | null): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, ...(partial ?? {}) };
}
