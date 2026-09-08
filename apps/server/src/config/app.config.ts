/**
 * 应用级环境变量与启动期密钥校验。
 */

import { createLogger } from '@inkweaver/shared';
import { ConfigService } from '@nestjs/config';

const logger = createLogger({ scope: 'server:config' });

export interface AppRuntimeConfig {
  port: number;
  nodeEnv: string;
  appPublicUrl: string;
  corsOrigin: string | undefined;
}

/**
 * 读取 HTTP 服务运行时配置。
 */
export function getAppRuntimeConfig(config: ConfigService): AppRuntimeConfig {
  return {
    port: Number(config.get<string>('PORT', '3000')),
    nodeEnv: config.get<string>('NODE_ENV', 'development'),
    appPublicUrl: config.get<string>(
      'APP_PUBLIC_URL',
      'http://localhost:3003',
    ),
    corsOrigin: config.get<string>('CORS_ORIGIN'),
  };
}

/**
 * 判断密钥是否为空或占位弱值。
 * 输入：密钥字符串；输出：是否弱密钥
 */
export function isWeakSecret(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized.includes('change-me') ||
    normalized === 'fallback-secret-key'
  );
}

/**
 * 生产环境强制强密钥：弱/空则抛错阻断启动。
 * 非 production 仅 warn。
 *
 * 输入：ConfigService
 * 输出：无（副作用：warn 或 throw）
 */
export function assertStrongSecretsInProduction(config: ConfigService): void {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const jwt = config.get<string>('JWT_SECRET');
  const dbPass = config.get<string>('DB_PASSWORD');
  const redisPass = config.get<string>('REDIS_PASSWORD');

  const problems: string[] = [];
  if (isWeakSecret(jwt)) {
    problems.push('JWT_SECRET 未设置或为占位弱密钥');
  }
  if (isWeakSecret(dbPass)) {
    problems.push('DB_PASSWORD 未设置或为占位弱密钥');
  }
  // Redis 密码仅在显式配置时校验（允许本地无密码 Redis）
  if (redisPass !== undefined && redisPass !== '' && isWeakSecret(redisPass)) {
    problems.push('REDIS_PASSWORD 为占位弱密钥');
  }

  if (problems.length === 0) return;

  if (nodeEnv === 'production') {
    throw new Error(`生产环境拒绝弱密钥启动: ${problems.join('; ')}`);
  }

  for (const problem of problems) {
    logger.warn(problem);
  }
}

/** @deprecated 使用 assertStrongSecretsInProduction */
export function warnWeakSecretsIfProduction(config: ConfigService): void {
  assertStrongSecretsInProduction(config);
}
