# SyncBox-AI（InkWeaver）Agent 指南

本文件是仓库自带的工程指南，适用于处理 InkWeaver 代码和项目文档。权限、能力状态和外部操作由当前 Codex 治理上下文决定，本文件不扩大授权。

## 标准工作流

1. 明确目标、影响范围和验证标准。
2. 在 `apps/`、`packages/`、`deploy/` 或 `docs/` 中定位真实入口。
3. 遵循现有 workspace 依赖，实施最小且可逆的改动。
4. 根据改动范围运行相关 `typecheck`、`lint`、构建或定向测试。
5. 只有行为、架构、部署方式或已验证排障结论发生变化时，才更新对应文档。

## Monorepo 结构

| 层级 | 内容 |
|------|------|
| `apps/` | `server`、`web`、`h5`、`mobile`、`admin` |
| 基础包 | `shared`、`assets`、`platform`、`adapters` |
| 数据与业务包 | `api`、`services`、`db-adapter`、`sync-engine` |
| 编辑器与界面包 | `editor-core`、`editor-web`、`editor-mobile`、`ui` |

## 依赖边界

- 应用可以依赖共享包，但应用之间不得相互引用。
- `shared` 和 `assets` 不依赖其他 workspace 包。
- `editor-web`、`editor-mobile` 依赖 `editor-core`，`editor-core` 依赖 `shared`。
- `sync-engine` 只依赖 `db-adapter` 与 `shared`。
- `services` 依赖 `api`、`platform` 与 `shared`；`ui` 当前依赖 `services`、`platform` 与 `shared`。
- `apps/server` 负责 Nest 服务端模块；`packages/api` 和 `packages/services` 面向可复用客户端访问与业务流程。

## 文档入口

| 文档 | 用途 |
|------|------|
| [docs/README.md](docs/README.md) | 文档中心与项目结构总览 |
| [架构.md](docs/架构.md) | 模块职责、依赖边界与同步链路 |
| [UI规范.md](docs/UI规范.md) | 设计令牌、组件与跨端 UI 约束 |
| [运维.md](docs/运维.md) | 环境、部署、迁移、监控与排障 |

## 常用命令

```bash
pnpm install
pnpm dev:server
pnpm dev:web
pnpm typecheck
pnpm lint
```

启动 Docker、本地服务、生产部署或迁移前，应先确认当前任务授权与环境文件已准备好。

## CodeGraph

- CodeGraph 是项目级条件能力，仅用于直接检查不足以完成的跨包依赖、调用链、架构或影响分析。
- 已知文件修改、文档任务、常规命令和常规测试不得调用。
- 项目配置只开放 `codegraph_explore`；不得自动初始化或扩大 MCP 工具范围。
- 初始化、重建或同步索引必须符合侧车能力状态，并获得当前任务明确授权。

## 项目内规则

- `AGENTS.md`：项目工程规范和 Agent 指令入口。

不得引用或依赖仓库外的个人 Skill、个人资料目录或未注册项目。
