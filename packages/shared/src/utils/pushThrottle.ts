/**
 * 推送节流：合并短时间内的多次回调。
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
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) {
        fn(...lastArgs);
        lastArgs = null;
      }
    }, delayMs);
  };
}
