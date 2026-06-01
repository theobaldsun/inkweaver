# InkWeaver PC Web (`@inkweaver/web`)

PC 端 Web 客户端：Vite + React 19，本地优先（Dexie）+ Yjs 同步 + TipTap 富文本编辑。

## 开发

```bash
# 在 monorepo 根目录
pnpm install
pnpm dev:server   # 后端 API（:3000）
pnpm dev:web      # 本应用（:3003）
```

浏览器访问：http://localhost:3003

## 环境变量（可选）

| 变量 | 说明 | 默认 |
|------|------|------|
| `VITE_API_BASE_URL` | REST API 前缀 | `/api` |
| `VITE_SYNC_SOCKET_URL` | Socket.io 同步地址 | 开发：同源 `/sync` |
| `VITE_ENABLE_MOCK_FALLBACK` | 开发 Mock 回退 | `false` |

## 脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | Vite 开发服 |
| `pnpm build` | 生产构建 → `dist/` |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm lint` | ESLint |

## 主要路由

- `/login` — 登录/注册
- `/notes` — 文档列表
- `/search` — 搜索（支持 `?q=`）
- `/trash` — 回收站
- `/profile` — 个人中心（`?tab=notifications` 等）
- `/documents/new`、`/documents/:id` — 编辑

## 与 `apps/h5` 差异

PC Web 提供完整 Layout（侧栏 + 顶栏）、回收站与多 Tab 个人中心；H5 为移动轻量壳层。详见 `docs/SYSTEM_DESIGN.md`。
