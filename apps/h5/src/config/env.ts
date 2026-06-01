/**
 * H5 端环境变量。
 */

const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const API_BASE_URL = apiBase?.replace(/\/$/, '') || '/api';

function deriveSyncUrlFromApiBase(base: string): string | undefined {
  if (!/^https?:\/\//i.test(base)) return undefined;
  try {
    const url = new URL(base);
    return `${url.origin}/sync`;
  } catch {
    return undefined;
  }
}

export const SYNC_SOCKET_URL =
  (import.meta.env.VITE_SYNC_SOCKET_URL as string | undefined)?.replace(/\/$/, '') ||
  deriveSyncUrlFromApiBase(apiBase ?? '') ||
  `${window.location.origin}/sync`;

export const APP_PUBLIC_URL =
  (import.meta.env.VITE_APP_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ||
  window.location.origin;
