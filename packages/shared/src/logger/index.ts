/**
 * 轻量日志模块（跨端可用）。
 *
 * 用途：
 * - 在不引入大型日志库的情况下，为各 app/package 提供一致的日志接口
 * - 便于后续替换为更强的实现（例如接入 Sentry/Datadog/结构化日志）
 *
 * 输入：日志级别、scope、日志内容
 * 输出：写入 console（后续可扩展为写文件/上报）
 */

export type LoggerLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /**
   * 日志作用域，用于区分来源模块。
   */
  scope: string;
  /**
   * 最低输出级别。
   *
   * - 输入：日志级别字符串
   * - 输出：过滤规则
   */
  level?: LoggerLevel;
}

export interface Logger {
  /**
   * 打印 debug 级别日志。
   *
   * 输入：任意参数（会透传给 console.debug）
   * 输出：无
   */
  debug: (...args: unknown[]) => void;
  /**
   * 打印 info 级别日志。
   *
   * 输入：任意参数（会透传给 console.info）
   * 输出：无
   */
  info: (...args: unknown[]) => void;
  /**
   * 打印 warn 级别日志。
   *
   * 输入：任意参数（会透传给 console.warn）
   * 输出：无
   */
  warn: (...args: unknown[]) => void;
  /**
   * 打印 error 级别日志。
   *
   * 输入：任意参数（会透传给 console.error）
   * 输出：无
   */
  error: (...args: unknown[]) => void;
}

const LEVEL_WEIGHT: Record<LoggerLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(minLevel: LoggerLevel, current: LoggerLevel): boolean {
  return LEVEL_WEIGHT[current] >= LEVEL_WEIGHT[minLevel];
}

/**
 * 创建一个带 scope 的日志器。
 *
 * 输入：LoggerOptions（scope 必填）
 * 输出：Logger（debug/info/warn/error）
 */
export function createLogger(options: LoggerOptions): Logger {
  const minLevel = options.level ?? "info";
  const prefix = `[${options.scope}]`;

  return {
    debug: (...args) => {
      if (shouldLog(minLevel, "debug")) console.debug(prefix, ...args);
    },
    info: (...args) => {
      if (shouldLog(minLevel, "info")) console.info(prefix, ...args);
    },
    warn: (...args) => {
      if (shouldLog(minLevel, "warn")) console.warn(prefix, ...args);
    },
    error: (...args) => {
      if (shouldLog(minLevel, "error")) console.error(prefix, ...args);
    },
  };
}

