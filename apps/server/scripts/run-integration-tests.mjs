/**
 * 运行 server 同步集成测试。
 *
 * 前置：`docker compose -f docker-compose.test.yml up -d`（Postgres 127.0.0.1:5433）
 * 环境：自动设置 RUN_INTEGRATION_TESTS=1
 */

import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  [
    '--import',
    'reflect-metadata',
    '--test',
    'dist/modules/sync/sync.integration.test.js',
  ],
  {
    env: { ...process.env, RUN_INTEGRATION_TESTS: '1' },
    stdio: 'inherit',
  },
);

child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
