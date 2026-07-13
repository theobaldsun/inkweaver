# InkWeaver（SyncBox-AI）

Local-First 跨平台笔记应用：离线编辑、Yjs CRDT 实时同步、NestJS + PostgreSQL 云端协调。

## 快速开始

```bash
pnpm install
# 自备根 .env 与 apps/server/.env（变量说明见 docs/运维.md）
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

## 项目结构

- `apps/`：`server`、`web`、`h5`、`mobile`、`admin`
- `packages/`：共享基础、客户端 API/服务、同步与存储适配、编辑器和 UI
- `docs/`：架构、UI 规范、开发部署与排障
- `deploy/`：实例模板、Nginx 配置和部署脚本

## 文档

**[docs/README.md](docs/README.md)** — 当前架构、UI 规范与运维入口。

## 技术栈

Monorepo（pnpm + Turbo）· React 19 · Vite · Expo RN · NestJS · Yjs · TipTap
