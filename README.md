# InkWeaver（SyncBox-AI）

Local-First 跨平台笔记应用：离线编辑、Yjs CRDT 实时同步、NestJS + PostgreSQL 云端协调。

## 快速开始

```bash
pnpm install
cp docker.env.example .env          # Docker 密码
cp apps/server/.env.example apps/server/.env
docker compose up -d                # PostgreSQL + Redis + Mailhog
pnpm dev:server                     # http://localhost:3000
pnpm dev:web                        # http://localhost:3003
```

Mailhog 邮件 UI：http://localhost:8025

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev:server` | 后端 API |
| `pnpm dev:web` | PC Web 客户端 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm build` | 构建全部包与应用 |
| `pnpm build:server` / `pnpm build:web` | 单独构建 |

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) | 系统架构、模块职责、同步设计 |
| [docs/MVP_ACCEPTANCE.md](docs/MVP_ACCEPTANCE.md) | Web/Server MVP 功能矩阵与验收用例 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 生产部署、环境变量、Nginx |
| [deploy/README.md](deploy/README.md) | **单机阿里云部署速查** |
| [docs/PROBLEM_RECORDS.md](docs/PROBLEM_RECORDS.md) | 已解决问题与最佳实践 |
| [AGENTS.md](AGENTS.md) | Cursor Agent 工作指南 |

## 技术栈

Monorepo（pnpm + Turbo）· React 19 · Vite · Expo RN · NestJS · TypeORM · PostgreSQL · Redis · Yjs · TipTap

## 仓库结构

```
apps/       server · web · h5 · mobile · admin
packages/   shared · api · services · sync-engine · editor-* · ui · ...
docs/       设计与运维文档
```
