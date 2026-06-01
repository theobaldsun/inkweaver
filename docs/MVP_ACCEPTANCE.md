# Web/Server MVP 验收文档

**范围**：`apps/web` + `apps/server`（不含 AI 完整能力、h5/mobile 完全对齐）

**文档版本**：1.0  
**最后更新**：2026-05-28

---

## 1. 功能矩阵

| 领域 | 能力 | 状态 | 关键路径 |
|------|------|------|----------|
| 认证 | 注册/登录/忘记密码/重置密码 | ✅ 完成 | `AuthPage.tsx`、`users.service.ts` |
| 认证 | Access Token 自动刷新 | ✅ 完成 | `packages/api/src/client.ts`、`AuthRoute.tsx` |
| 文档 | 列表/筛选/排序、TipTap 编辑 | ✅ 完成 | `NoteListPage.tsx` |
| 文档 | 文件夹树、软删回收站 | ✅ 完成 | `documents.service.ts` |
| 同步 | Yjs push/pull、WS 房间、409 恢复 | ✅ 完成 | `syncService.ts`、`sync.controller.ts` |
| 同步 | WebSocket JWT + 文档归属校验 | ✅ 完成 | `sync.gateway.ts` |
| 同步 | Yjs → PG title/content 投影 | ✅ 完成 | `document-projection.service.ts`、`DocumentEditPage.tsx` |
| 分享 | 公开链接、`/shared/:token` 只读 | ✅ 完成 | `SharedDocumentPage.tsx` |
| 通知 | 铃铛、Profile 收件箱 | ✅ 完成 | `NotificationBell.tsx` |
| 邮件 | BullMQ + Mailhog 本地调试 | ✅ 完成 | `mail.module.ts`、`docker-compose.yml` |
| 存储 | 头像/图片上传、用量统计 | ✅ 完成 | `storage.controller.ts` |
| 搜索 | 关键词搜索 + 历史 | ✅ 完成 | `search` 模块 |
| 健康 | `/healthz`、`/readyz`（Redis + PG） | ✅ 完成 | `health.controller.ts` |
| 部署 | TypeORM migrations、`.env.example` | ✅ 完成 | `data-source.ts`、`apps/server/.env.example` |
| AI | 仅 `GET /api/ai/ping` | ⏸ MVP 范围外 | `ai.controller.ts` |

### P2 已知缺口（不阻塞首版上线）

| 项 | 说明 |
|----|------|
| `filter=mine` | 前后端均未实现，映射为 `all` |
| 通知点击跳转 | 无 `metadata.docId` 导航 |
| 搜索/回收站分页 | 未实现 |
| 分享页 XSS | `dangerouslySetInnerHTML` 未消毒 |
| h5 对齐 | 与 web 未完全同步 |

---

## 2. P0 修复清单（已关闭）

| ID | 项 | 验收标准 |
|----|-----|----------|
| P0-1 | Yjs → PG 投影 | 编辑后搜索、分享页、列表标题/摘要与编辑器一致 |
| P0-2 | Token 自动刷新 | access 过期无感刷新；refresh 失效才跳登录 |
| P0-3 | WebSocket 鉴权 | 无 token 或他人 docId 无法 join/推送 |

---

## 3. 手工验收用例

### 前置条件

```bash
# 根目录
docker compose up -d
pnpm install
cp apps/server/.env.example apps/server/.env   # 密码与 docker .env 对齐
pnpm dev:server   # :3000
pnpm dev:web      # :3003
```

Mailhog UI：http://localhost:8025

### 用例 1：注册自动登录

1. 打开 http://localhost:3003/register
2. 填写邮箱、密码、昵称并提交
3. **预期**：进入首页，无 `user.id` 报错，localStorage 有 `syncbox_auth_tokens`

### 用例 2：编辑 → 搜索 → 分享

1. 新建文档，编辑标题与正文，等待约 2 秒
2. 全局搜索关键词
3. **预期**：能命中该文档
4. 开启分享，复制链接，无痕窗口打开
5. **预期**：只读页内容与编辑器一致

### 用例 3：忘记密码

1. 登录页点击「忘记密码」，输入已注册邮箱
2. Mailhog 查看邮件（或生产 SMTP 收件箱）
3. 点击重置链接，设置新密码
4. **预期**：新密码可登录

### 用例 4：删除与通知

1. 删除一篇文档
2. **预期**：通知铃铛有记录；回收站可恢复

### 用例 5：Token 刷新（P0-2）

1. 登录后，将 `JWT_EXPIRES_IN` 临时改为 `30s` 并重启 server
2. 等待 access 过期后继续操作（如打开文档列表）
3. **预期**：不跳登录，请求自动恢复

### 用例 6：就绪探针

```bash
curl http://localhost:3000/readyz
```

**预期**：`redis: up`，`postgres: up`（或开发库已连接时）

### 用例 7：WebSocket 鉴权（P0-3）

1. 无 token 连接 `ws://localhost:3000/sync` 并 `join-doc`
2. **预期**：连接被拒绝或断开
3. 用户 A 尝试 join 用户 B 的 docId
4. **预期**：join 失败

---

## 4. 自动化检查

```bash
pnpm typecheck
pnpm build:server
pnpm build:web
```

生产数据库首次部署：

```bash
cd apps/server
pnpm migration:run
```

---

## 5. 相关文档

- [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md) — 架构与模块职责
- [DEPLOYMENT.md](./DEPLOYMENT.md) — 上线部署
- [PROBLEM_RECORDS.md](./PROBLEM_RECORDS.md) — 已解决问题
