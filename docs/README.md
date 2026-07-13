# InkWeaver 项目文档

本目录只保留与当前代码和部署资产对应的长期文档。实现、依赖版本、脚本参数和环境变量以仓库中的代码与配置为最终事实来源。

## 文档入口

| 文档 | 内容 | 主要事实来源 |
|------|------|--------------|
| [架构.md](./架构.md) | Monorepo 分层、依赖边界、本地优先与同步链路 | `package.json`、`apps/`、`packages/` |
| [UI规范.md](./UI规范.md) | 设计令牌、组件、编辑器和响应式约定 | `apps/web/src/index.css`、`packages/ui`、`packages/editor-web` |
| [运维.md](./运维.md) | 本地环境、Docker、生产部署、迁移、监控与常见故障 | Compose、`deploy/`、`apps/server` |

项目级工程工作流与验证要求见根目录 [AGENTS.md](../AGENTS.md)。

## 结构入口

- `apps/`：`server`、`web`、`h5`、`mobile`、`admin`。
- `packages/`：共享类型、平台适配、API、业务服务、存储、同步、编辑器与 UI。
- `deploy/`：生产脚本、Nginx 配置和本地实例信息模板。
- 根目录 `package.json`：开发、构建、lint 与 typecheck 命令的唯一脚本清单。

## 维护原则

- 文档描述稳定边界和可重复操作，不复制可直接从代码读取的大段接口、Props 或版本清单。
- 架构、依赖或运行链路变化时更新 `架构.md`。
- 设计令牌或 UI 约束变化时更新 `UI规范.md`；具体数值同时以源码中的令牌为准。
- 环境变量、部署脚本、迁移或监控方式变化时更新 `运维.md`。
- 已关闭 Bug、一次性验收状态、迁移过程记录和旧文件名跳转不进入长期文档；必要信息应归并为仍可执行的规则或排障步骤。
- 不记录密码、Token、私钥、完整 `.env`、真实服务器地址或其他实例私密信息。

## 验证入口

根据改动范围选择根 `package.json` 中的命令：

```bash
pnpm typecheck
pnpm lint
pnpm build:server
pnpm build:web
```

只修改文档时，应至少检查项目内相对链接与旧路径引用；部署或外部系统验证需要当前任务的明确授权和可用环境。
