# InkWeaver（SyncBox-AI）

Local-First 跨平台笔记应用：离线编辑、Yjs CRDT 实时同步、NestJS + PostgreSQL 云端协调。

## 快速开始

```bash
pnpm install
# 自备根 .env 与 apps/server/.env（变量说明见 docs/部署迁移/部署运维.md §2）
docker compose up -d
pnpm dev:server
pnpm dev:web
```

Mailhog：http://localhost:8025

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev:server` | 后端 API |
| `pnpm dev:web` | PC Web |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm build` | 构建全部 |

## 文档

**[docs/README.md](docs/README.md)** — 架构、运维、排障、MVP 验收、设计规范。

## 技术栈

Monorepo（pnpm + Turbo）· React 19 · Vite · Expo RN · NestJS · Yjs · TipTap
