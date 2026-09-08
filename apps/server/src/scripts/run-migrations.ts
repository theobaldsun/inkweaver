/**
 * 生产环境迁移入口：使用已编译的 data-source 与 migrations。
 * 用法：node dist/scripts/run-migrations.js
 */

import 'reflect-metadata';
import { join } from 'path';

import { DataSource } from 'typeorm';

async function run(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'postgres',
    port: Number(process.env.DB_PORT ?? '5432'),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'syncbox_db',
    migrations: [join(__dirname, '..', 'migrations', '*.js')],
    synchronize: false,
    logging: process.env.TYPEORM_LOGGING === 'true',
  });

  await dataSource.initialize();
  const executed = await dataSource.runMigrations();
  console.log(`[migrations] Applied ${executed.length} migration(s)`);
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('[migrations] Failed:', err);
  process.exit(1);
});
