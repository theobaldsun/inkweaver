/**
 * 轻提示：1 秒后自动消失，用于「暂未开发」等简短反馈。
 */

import { Info } from 'lucide-react';
import React, { useEffect, useState } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastState {
  message: string;
  type: ToastType;
}

let toastState: ToastState | null = null;
let toastListeners: Array<() => void> = [];
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  toastListeners.forEach((fn) => fn());
}

/**
 * 显示顶部轻提示。
 * @param message 提示文案
 * @param type 样式类型
 * @param durationMs 显示时长（毫秒）
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  durationMs: number = 1000,
): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
  }
  toastState = { message, type };
  notify();
  hideTimer = setTimeout(() => {
    toastState = null;
    hideTimer = null;
    notify();
  }, durationMs);
}

export const ToastHost: React.FC = () => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  if (!toastState) {
    return null;
  }

  return (
    <div className={`app-toast app-toast--${toastState.type}`} role="status" aria-live="polite">
      <Info size={18} className="app-toast__icon" />
      <span>{toastState.message}</span>
    </div>
  );
};
