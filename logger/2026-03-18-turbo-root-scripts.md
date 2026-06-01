/**
 * 2026-03-18：使用 Turbo 将子项目命令提升到根目录。
 *
 * 用途：
 * - 统一 monorepo 操作入口，减少“进入子目录再执行命令”的摩擦
 *
 * 输入：monorepo 任务（dev/build/lint/typecheck）
 * 输出：在根目录一键运行指定 workspace 的任务
 */

## 变更

- 根 `package.json` 新增脚本（通过 Turbo filter 选择 workspace）：
  - `dev:server` / `build:server` / `lint:server` / `typecheck:server` / `start:server`
  - 同步提供 `dev:*`、`build:*`（admin/h5/mobile）

## 使用方式

- 启动 server（开发）：
  - `pnpm dev:server`
- 构建 server：
  - `pnpm build:server`
- server 类型检查与 lint：
  - `pnpm typecheck:server`
  - `pnpm lint:server`

## 验证方式

- `pnpm typecheck:server`
- `pnpm lint:server`

