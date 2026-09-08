/**
 * TypeORM 数据源配置（Nest forRootAsync）。
 */

import { ConfigService } from '@nestjs/config';

import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * 是否启用 TypeORM（与 app.module 逻辑一致）。
 */
export function isTypeOrmEnabled(config?: ConfigService): boolean {
  const explicit =
    config?.get<string>('TYPEORM_ENABLED') ?? process.env.TYPEORM_ENABLED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  const dbHost = config?.get<string>('DB_HOST') ?? process.env.DB_HOST;
  const databaseUrl =
    config?.get<string>('DATABASE_URL') ?? process.env.DATABASE_URL;
  return Boolean(dbHost || databaseUrl);
}

/**
 * 构建 TypeOrmModule.forRoot 选项。
 */
export function getTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: Number(config.get<string>('DB_PORT', '5432')),
    username: config.get<string>('DB_USERNAME', 'postgres'),
    password: config.get<string>('DB_PASSWORD', ''),
    database: config.get<string>('DB_DATABASE', 'syncbox_db'),
    autoLoadEntities: true,
    synchronize: false,
    cache: false,
  };
}
