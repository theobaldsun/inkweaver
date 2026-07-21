/**
 * 推送节流：窗口内多次调用在窗口结束后按入队顺序全部执行。
 *
 * 调用方应在回调内自行合并缓冲（如 DocumentEditPage 的 pending Map），
 * 同一 docId 多次入队时后续调用会读到已清空缓冲并 no-op。
 */

/**
 * 创建节流函数。
 * @param fn 待节流函数
 * @param delayMs 延迟毫秒
 */
export function createPushThrottle<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queuedArgs: Parameters<T>[] = [];

  return (...args: Parameters<T>) => {
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
}
