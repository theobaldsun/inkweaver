# SyncBox-AI (InkWeaver) — Agent 指南

跨平台 Local-First 笔记应用：离线编辑 + Yjs CRDT 实时同步 + Nest/PostgreSQL 云端协调。

## 技术栈速览

- **Monorepo**：pnpm workspace + Turbo
- **前端**：React 19、Vite（web/h5/admin）、Expo RN（mobile）
- **后端**：NestJS、TypeORM、PostgreSQL、Redis、Socket.io
- **同步/编辑**：Yjs、`packages/sync-engine`、TipTap（web）

## 目录结构

```
apps/       server · web · h5 · mobile · admin
packages/   shared · api · services · sync-engine · db-adapter · editor-* · ui · ...
docs/       PROBLEM_RECORDS.md · SYSTEM_DESIGN.md · MVP_ACCEPTANCE.md · DEPLOYMENT.md
```

## Cursor 规则（自动应用）

| 规则文件 | 说明 |
|----------|------|
| `.cursor/rules/syncbox-ai-assistant.mdc` | 助手角色、职责、工作流 |
| `.cursor/rules/monorepo-architecture.mdc` | 架构与依赖边界 |
| `.cursor/rules/documentation-workflow.mdc` | 文档维护规范 |

## 参考文档

- [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) — 系统设计、依赖图、同步与数据库
- [docs/MVP_ACCEPTANCE.md](docs/MVP_ACCEPTANCE.md) — Web/Server MVP 验收用例
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 生产部署与环境变量
- [deploy/README.md](deploy/README.md) — 单机阿里云部署速查
- [docs/PROBLEM_RECORDS.md](docs/PROBLEM_RECORDS.md) — 已解决问题与最佳实践

## 开发命令

```bash
pnpm install
docker compose up -d          # PostgreSQL :5432 · Redis :6379 · Mailhog :8025/:1025
pnpm dev:server               # 后端 API http://localhost:3000
pnpm dev:web                  # PC Web http://localhost:3003
pnpm dev:h5                   # 移动 Web
pnpm dev:mobile               # Expo 原生
pnpm build
pnpm typecheck
pnpm lint
```

本地邮件调试：Mailhog Web UI http://localhost:8025 ，SMTP `localhost:1025`。

## Agent 工作流

1. 分析需求 → 2. 在 `apps/` / `packages/` 定位代码 → 3. 给出方案并最小化改动 → 4. 验证（typecheck/lint/dev）→ 5. 验证通过后更新 `docs/` 文档
