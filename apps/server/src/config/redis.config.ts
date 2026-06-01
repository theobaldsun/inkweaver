/**
 * Redis 连接配置（BullMQ / 健康检查共用）。
 */

import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

/**
 * 从环境变量构建 ioredis 连接选项（BullMQ / 健康检查共用）。
 */
export function getRedisConnectionOptions(config: ConfigService): RedisOptions {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    return { ...configFromUrl(url), maxRetriesPerRequest: null };
  }

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: Number(config.get<string>('REDIS_PORT', '6379')),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * BullMQ 根连接配置。
 */
export function getBullMqRootConfig(config: ConfigService): { connection: ConnectionOptions } {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    return { connection: { url, maxRetriesPerRequest: null } };
  }
  return { connection: getRedisConnectionOptions(config) };
}

/**
 * 解析 redis:// URL 为 ioredis 选项。
 */
function configFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}
