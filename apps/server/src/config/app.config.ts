/**
 * 应用级环境变量与启动期弱校验。
 */

import { ConfigService } from '@nestjs/config';
import { createLogger } from '@inkweaver/shared';

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
 * 生产环境对关键密钥做非空/弱密钥告警（不阻断启动，避免误伤本地）。
 */
export function warnWeakSecretsIfProduction(config: ConfigService): void {
  if (config.get<string>('NODE_ENV') !== 'production') return;

  const jwt = config.get<string>('JWT_SECRET', '');
  const dbPass = config.get<string>('DB_PASSWORD', '');

  if (!jwt || jwt.includes('change-me') || jwt === 'fallback-secret-key') {
    logger.warn('JWT_SECRET 未设置或为占位符，生产环境请使用强随机密钥');
  }
  if (!dbPass || dbPass.includes('change-me')) {
    logger.warn('DB_PASSWORD 未设置或为占位符');
  }
}
