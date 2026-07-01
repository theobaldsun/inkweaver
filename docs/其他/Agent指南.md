# SyncBox-AI (InkWeaver) — Agent 指南

跨平台 Local-First 笔记：离线编辑 + Yjs CRDT + Nest/PostgreSQL。

## 工作流

1. 分析需求 → 2. 在 `apps/` / `packages/` 定位 → 3. 最小改动实现 → 4. `pnpm typecheck` / `lint` → 5. 更新 [docs/README.md](../README.md)

## Monorepo 边界

- `apps` 只依赖 `packages`，app 间不互引
- `packages/shared` 不依赖 app；`sync-engine` 仅依赖 `shared`
- HTTP/API：`packages/api`；业务：`packages/services`

## 文档（统一入口）

**[docs/README.md](../README.md)** — 仅 InkWeaver 项目文档

| 文档 | 用途 |
|------|------|
| [系统架构.md](../架构设计/系统架构.md) | 架构与同步 |
| [部署运维.md](../部署迁移/部署运维.md) | 部署运维 |
| [问题排查.md](../问题解决/问题排查.md) | 踩坑记录 |
| [redirects/README.md](../redirects/README.md) | 旧文件名 → 现行正文 |


## 个人 Skill（可选）

| Skill | 用途 |
|-------|------|
| `~/.cursor/skills/inkweaver/` | 生产部署与 InkWeaver monorepo 速查 |
| `~/.cursor/skills/frontend-interview-prep/` | 求职模拟面试（读写 `career-prep/`） |

## 常用命令

```bash
pnpm install
# 自备根 .env 与 apps/server/.env（见 部署运维.md §2）
docker compose up -d
pnpm dev:server
pnpm dev:web
pnpm typecheck
```

## Cursor 规则

`.cursor/rules/syncbox-ai-assistant.mdc` · `monorepo-architecture.mdc` · `documentation-workflow.mdc`
