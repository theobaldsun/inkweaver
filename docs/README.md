# InkWeaver 文档中心

Local-First 跨端笔记（SyncBox-AI Monorepo）的**项目文档**统一入口。

> 个人求职/面试资料在仓库外：[../career-prep/README.md](../career-prep/README.md)（Desktop，勿写入本 repo）。

## 架构设计

| 文档 | 说明 |
|------|------|
| [系统架构.md](./架构设计/系统架构.md) | Monorepo 结构、模块职责、同步引擎、依赖边界 |
| [UI设计规范.md](./架构设计/UI设计规范.md) | Web UI 色彩、字体、组件与布局 |

## 部署迁移

| 文档 | 说明 |
|------|------|
| [部署运维.md](./部署迁移/部署运维.md) | 环境变量、Docker、Nginx、MinIO、脚本与数据库迁移 |

## 问题解决

| 文档 | 说明 |
|------|------|
| [问题排查.md](./问题解决/问题排查.md) | 已验证的 Bug、踩坑与生产排障（§9） |

## 其他

| 文档 | 说明 |
|------|------|
| [MVP验收.md](./其他/MVP验收.md) | Web/Server MVP 功能矩阵与验收用例 |
| [Agent指南.md](./其他/Agent指南.md) | Cursor Agent 工作流与 Monorepo 约定 |
| [AGENTS.md](../AGENTS.md) | 根目录快捷入口（跳转 Agent 指南） |

## 部署脚本与实例信息

| 路径 | 说明 |
|------|------|
| [deploy/README.md](../deploy/README.md) | 脚本与 Nginx 索引 |
| [deploy/INSTANCE.local.example](../deploy/INSTANCE.local.example) | 实例域名/IP/SSH（复制为 local，勿提交） |

## 旧文件名兼容

历史英文文档见 **[redirects/README.md](./redirects/README.md)**。

## 维护约定

- Bug/踩坑 → `问题解决/问题排查.md`
- 架构变更 → `架构设计/系统架构.md`
- 部署/运维变更 → `部署迁移/部署运维.md`
- 仅验证通过后写入，不记录密钥与完整 `.env`

**文档版本**: 2.0 · **最后更新**: 2026-06-12
