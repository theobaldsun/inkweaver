/**
 * Web 端环境变量（Vite import.meta.env）。
 */

const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;

/** REST API 根路径（默认同源 /api） */
export const API_BASE_URL = apiBase?.replace(/\/$/, '') || '/api';

/**
 * 从绝对 API 地址推导 Socket.io 命名空间（局域网直连后端时用）。
 */
function deriveSyncUrlFromApiBase(base: string): string | undefined {
  if (!/^https?:\/\//i.test(base)) return undefined;
  try {
    const url = new URL(base);
    return `${url.origin}/sync`;
  } catch {
    return undefined;
  }
}

/**
 * Socket.io 同步命名空间 URL。
 * 默认同源 /sync（需 Vite 代理 /socket.io）；局域网可设 VITE_SYNC_SOCKET_URL 或绝对 VITE_API_BASE_URL。
 */
export const SYNC_SOCKET_URL =
  (import.meta.env.VITE_SYNC_SOCKET_URL as string | undefined)?.replace(/\/$/, '') ||
  deriveSyncUrlFromApiBase(apiBase ?? '') ||
  `${window.location.origin}/sync`;

/** 前端公开 URL（分享链接、邮件跳转等） */
export const APP_PUBLIC_URL =
  (import.meta.env.VITE_APP_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ||
  window.location.origin;
