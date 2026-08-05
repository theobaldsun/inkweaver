/**
 * 推送节流：窗口内多次调用在窗口结束后按入队顺序全部执行。
 *
 * 调用方应在回调内自行合并缓冲（如 DocumentEditPage 的 pending Map），
 * 同一 docId 多次入队时后续调用会读到已清空缓冲并 no-op。
 */

/**
 * 节流函数类型：调用以入队，cancel 以取消尚未触发的执行。
 */
export type PushThrottle<T extends (...args: never[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  /** 取消尚未触发的节流执行，清空入队参数 */
  cancel: () => void;
};

/**
 * 创建节流函数。
 * @param fn 待节流函数
 * @param delayMs 延迟毫秒
 */
export function createPushThrottle<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): PushThrottle<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queuedArgs: Parameters<T>[] = [];

  const throttled = (...args: Parameters<T>) => {
    queuedArgs.push(args);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = queuedArgs;
      queuedArgs = [];
      for (const invocation of batch) {
        fn(...invocation);
      }
    }, delayMs);
  };

  // 暴露 cancel 供调用方在卸载时清理，避免 timer 在组件卸载后仍触发闭包
  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    queuedArgs = [];
  };

  return throttled as PushThrottle<T>;
}
