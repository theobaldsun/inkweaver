/**
 * 运行 server 集成测试，包含 Agent 完整保存链路的离线验收。
 *
 * 前置：`docker compose -f docker-compose.test.yml up -d`（Postgres 127.0.0.1:5433）
 * 环境：自动设置 RUN_INTEGRATION_TESTS=1
 */

import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [
    "--import",
    "reflect-metadata",
    "--test",
    "--test-concurrency=1",
    "dist/modules/users/data-integrity.integration.test.js",
    "dist/modules/agent/agent-runs.integration.test.js",
    "dist/modules/agent/agent-conversation.persistence.integration.test.js",
    "dist/modules/agent/agent-v1.persistence.integration.test.js",
    "dist/modules/agent/tools/tool-call.persistence.integration.test.js",
    "dist/modules/sync/sync.integration.test.js",
    "dist/core-http.integration.test.js",
  ],
  {
    env: { ...process.env, RUN_INTEGRATION_TESTS: "1" },
    stdio: "inherit",
  },
);

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
