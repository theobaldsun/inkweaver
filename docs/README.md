# InkWeaver 项目文档

本目录只保留与当前代码和部署资产对应的长期文档。实现、依赖版本、脚本参数和环境变量以仓库中的代码与配置为最终事实来源。

## 文档入口

| 文档 | 内容 | 主要事实来源 |
|------|------|--------------|
| [架构.md](./架构.md) | Monorepo 分层、依赖边界、本地优先与同步链路、功能模块架构概览 | `package.json`、`apps/`、`packages/` |
| [UI规范.md](./UI规范.md) | 设计令牌、组件、编辑器和响应式约定 | `apps/web/src/index.css`、`packages/ui`、`packages/editor-web` |
| [部署与发布.md](./部署与发布.md) | 当前 ECS 的完整发布、低内存流程、验收、回滚与典型问题 | Compose、`deploy/`、生产验证记录 |
| [运维.md](./运维.md) | 环境、生产拓扑、健康检查和常见运行故障 | Compose、`deploy/`、`apps/server` |
| [内网穿透与Embedding服务.md](./内网穿透与Embedding服务.md) | Windows embedding、frpc、ECS frps、Token、防火墙和链路排障 | `services/embed-service`、FRP 配置 |
| [Ubuntu服务器操作指令.md](./Ubuntu服务器操作指令.md) | Ubuntu、systemd、UFW、Nginx、Docker、Git 与资源排障命令 | 当前 ECS 运维流程 |
| [PostgreSQL数据库操作语句.md](./PostgreSQL数据库操作语句.md) | psql、CRUD、事务、JSONB、数组、全文检索、pgvector 和 migration | PostgreSQL 16、pgvector、TypeORM |
| [Issue.md](./Issue.md) | 已发现缺陷的根因、修复、验证和状态 | 代码、测试与生产证据 |

项目级工程工作流与验证要求见根目录 [AGENTS.md](../AGENTS.md)。

## 结构入口

- `apps/`：`server`、`web`、`h5`、`mobile`、`admin`。
- `packages/`：共享类型、平台适配、API、业务服务、存储、同步、编辑器与 UI。
- `deploy/`：生产脚本、Nginx 配置和本地实例信息模板。
- 根目录 `package.json`：开发、构建、lint 与 typecheck 命令的唯一脚本清单。
- `docs/notes/`：技术笔记独立文件，按编号组织，主文件 docs/技术笔记.md 作导览。

## 维护原则

- 文档描述稳定边界和可重复操作，不复制可直接从代码读取的大段接口、Props 或版本清单。
- 架构、依赖或运行链路变化时更新 `架构.md`。
- 设计令牌或 UI 约束变化时更新 `UI规范.md`；具体数值同时以源码中的令牌为准。
- 环境变量、部署脚本、迁移或监控方式变化时更新 `运维.md`。
- 完整发布顺序或回滚策略变化时更新 `部署与发布.md`；`deploy/README.md` 只保留脚本速查。
- FRP、embedding 地址、Token 分层或防火墙链路变化时更新 `内网穿透与Embedding服务.md`。
- 已关闭 Bug、一次性验收状态、迁移过程记录和旧文件名跳转不进入长期文档；必要信息应归并为仍可执行的规则或排障步骤。
- 不记录密码、Token、私钥、完整 `.env`、真实服务器地址或其他实例私密信息。
- 技术笔记按编号独立成文于 `docs/notes/`，主文件仅作导览；新增笔记时同步更新目录表。

## 验证入口

根据改动范围选择根 `package.json` 中的命令：

```bash
pnpm typecheck
pnpm lint
pnpm build:server
pnpm build:web
```

只修改文档时，应至少检查项目内相对链接与旧路径引用；部署或外部系统验证需要当前任务的明确授权和可用环境。
