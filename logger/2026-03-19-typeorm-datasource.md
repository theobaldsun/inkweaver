/**
 * 2026-03-19：TypeORM DataSource 接入与启动开关。
 *
 * 用途：
 * - 解决 Repository 注入时缺少 DataSource 的启动错误
 * - 支持在未准备 DB 时仍可启动非 DB 模块（便于并行开发）
 *
 * 输入：环境变量（DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE/TYPEORM_ENABLED）
 * 输出：Nest 应用中注册的 TypeORM DataSource（或跳过）
 */

## 变更

- `apps/server/src/app.module.ts`
  - 增加 `TypeOrmModule.forRoot(...)`（PostgreSQL）
  - 增加开关 `TYPEORM_ENABLED`：
    - `true`：启用 DB，并加载 `UsersModule` / `DocumentsModule`
    - `false`：跳过 DB 与依赖 DB 的模块（仍可启动健康检查、同步、AI 等）
    - 未设置：若存在 `DB_HOST` 或 `DATABASE_URL` 则默认启用

## 验证

- 启用 DB（你现有 `.env` 已包含 DB_*）：
  - `pnpm dev:server`
- 禁用 DB（验证可启动）：
  - 设置 `TYPEORM_ENABLED=false` 后 `pnpm dev:server`

