/**
 * 2026-03-18：服务端（NestJS）骨架搭建日志。
 *
 * 用途：
 * - 记录本次服务端基础架构落地情况，便于后续按 README 继续扩展
 *
 * 输入：本次迭代变更集合
 * 输出：变更说明与验证步骤
 */

## 背景/目标

- 依据 `README.md` 的技术架构（NestJS + REST + 后续 WebSocket + Bull + TypeORM + PostgreSQL/Redis/OSS）
- 先落地 **可运行的服务端骨架**，并保持 apps/packages 边界清晰

## 主要变更

- **NestJS 入口**：`apps/server/src/main.ts` 改为 Nest 启动 + 全局 `ValidationPipe`
- **根模块**：`apps/server/src/app.module.ts` 聚合模块
- **模块划分（骨架）**：
  - `HealthModule`：`GET /healthz`
  - `UsersModule`：`POST /api/users/register`（DTO 校验占位）
  - `DocumentsModule`：`GET /api/docs/:docId`（占位）
  - `SyncModule`：`POST /api/sync/push`、`GET /api/sync/pull/:afterSeq`（占位协议）
  - `StorageModule`：上传策略占位
  - `AiModule`：`GET /api/ai/ping` 占位
- **运行与构建脚本**：`dev` 使用 `tsx watch`，`build` 使用 `tsc` 输出到 `dist/`
- **环境变量示例**：`apps/server/.env.example`

## 验证方式

- 安装依赖：`pnpm install`
- 类型检查：`pnpm typecheck`
- 启动服务：`pnpm --filter @syncbox/server dev`
- 访问健康检查：`GET http://localhost:3001/healthz`

## 影响范围

- 仅影响 `apps/server` 的运行方式与新增模块文件，不影响其他 apps/packages

## 后续 TODO（按 README 继续落地）

- 接入认证：Passport JWT、登录/刷新、多设备会话管理
- 接入 TypeORM + PostgreSQL（并做可选启用开关，便于本地无 DB 时启动）
- 接入 Bull + Redis（异步任务：语音转写、文档转换、邮件等）
- 接入对象存储：MinIO/OSS（附件/图片/录音）
- 同步模块引入 WebSocket 网关与冲突策略（版本向量/LWW → CRDT）

