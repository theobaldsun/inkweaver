# InkWeaver 部署指南（云厂商无关）

**文档版本**：1.0  
**最后更新**：2026-05-28

---

## 1. 目标架构

```
用户浏览器
    ├── CDN / Nginx ──► apps/web dist（静态）
    └── 负载均衡 / Nginx
            ├── api.example.com ──► Nest Server :3000（REST）
            └── WebSocket /sync ──► Socket.io（与 API 同进程）

Nest Server
    ├── PostgreSQL（业务数据）
    ├── Redis（BullMQ 邮件队列）
    ├── OSS/S3（头像、文档图片，多实例前必须）
    └── SMTP（事务邮件）
```

---

## 2. 资源清单（MVP）

| 资源 | 用途 | 建议规格 |
|------|------|----------|
| 云服务器 ECS/VPS | Nest API + 可选 Nginx | 2 核 4GB 起 |
| 域名 | Web + API 子域 | `app.` + `api.` |
| SSL 证书 | HTTPS | Let's Encrypt 或 CDN 证书 |
| PostgreSQL | 业务库 | RDS 1GB+ 或自建 |
| Redis | BullMQ | 256MB+，**必须密码** |
| 对象存储 OSS/S3 | 上传文件 | 按量，~10GB 起 |
| SMTP | 密码重置等 | SendGrid / 云邮件 / 企业邮 |
| CDN（可选） | 静态资源 | 与 Nginx 二选一 |

**MVP 可不采购**：Kubernetes、Elasticsearch、独立 AI GPU、Kafka。

---

## 3. 环境变量

### 3.1 Server（`apps/server/.env`）

参考 [`apps/server/.env.example`](../apps/server/.env.example)：

| 变量 | 说明 |
|------|------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DB_*` | PostgreSQL 连接 |
| `REDIS_*` | Redis（与 BullMQ 一致） |
| `JWT_SECRET` | 强随机，各实例一致 |
| `APP_PUBLIC_URL` | 前端公网 URL |
| `CORS_ORIGIN` | 逗号分隔允许来源 |
| `SMTP_*` | 生产邮件服务 |

Docker 中间件密码：根目录 `docker.env.example` → `.env`。

### 3.2 Web 构建

```bash
VITE_API_BASE_URL=https://api.yourdomain.com/api pnpm build:web
```

产物目录：`apps/web/dist`。

---

## 4. 构建与数据库

```bash
pnpm install
pnpm build:server
pnpm build:web

# 生产库（synchronize=false）
cd apps/server
NODE_ENV=production pnpm migration:run
```

开发环境 `NODE_ENV=development` 时 TypeORM `synchronize: true`；**生产必须关闭并仅用 migration**。

---

## 5. 上线步骤

1. 完成 P0 修复并通过 [MVP_ACCEPTANCE.md](./MVP_ACCEPTANCE.md) 验收
2. 部署 PostgreSQL、Redis（内网访问，设防火墙）
3. 配置 `apps/server/.env`，`JWT_SECRET` 与 SMTP
4. 执行 `migration:run` 初始化 schema
5. 启动 API：`node apps/server/dist/main.js` 或 PM2 / Docker
6. 上传 `apps/web/dist` 至 CDN 或 Nginx 静态目录
7. 配置 Nginx 反向代理（见下节）
8. 验证忘记密码邮件到达真实收件箱
9. 配置监控：`/healthz` 存活、`/readyz` 就绪（Redis + PG）
10. PG 每日备份；OSS 版本控制；`.env` 不入库

---

## 6. Nginx 示例

```nginx
# API + WebSocket
server {
    listen 443 ssl http2;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /sync/ {
        proxy_pass http://127.0.0.1:3000/sync/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}

# 静态 Web
server {
    listen 443 ssl http2;
    server_name app.example.com;
    root /var/www/inkweaver/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 7. Docker Compose（本地 / 单节点）

仓库根目录：

```bash
docker compose up -d   # postgres + redis + mailhog
pnpm dev:server
pnpm dev:web
```

生产多实例前，将 `uploads/` 本地目录切换为 OSS（见 `storage` 模块）或共享卷。

---

## 8. 监控与备份

| 项 | 方式 |
|----|------|
| 存活 | `GET /healthz` |
| 就绪 | `GET /readyz`（redis + postgres） |
| 日志 | PM2 / Docker logs / 云日志服务 |
| PG 备份 | 云 RDS 自动快照或 `pg_dump` 定时任务 |
| 密钥 | 仅环境变量 / 密钥管理服务，禁止提交 Git |

---

## 9. 相关文档

- [MVP_ACCEPTANCE.md](./MVP_ACCEPTANCE.md)
- [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md)
- [PROBLEM_RECORDS.md](./PROBLEM_RECORDS.md)
- [deploy/README.md](../deploy/README.md) — 单机部署速查

---

## 附录 A：阿里云 2C2G 单机 Docker（低成本）

**适用**：已购 ECS（2 核 2G / 40GB SSD / Ubuntu 22.04），PostgreSQL + Redis + API 同机 Docker；Web 静态由 Nginx 托管；SMTP 用 QQ 邮箱；文件存宿主机磁盘。**仅成本：ECS + 域名**（SSL 免费）。

### A.1 架构

单域名 `app.example.com`：`/` 为 Web，`/api`、`/sync`、`/socket.io`、`/uploads` 反代到 `127.0.0.1:3000`。

```
浏览器 → Nginx:443 → /opt/inkweaver/web (静态)
                  → Docker server:3000 → postgres / redis
                  → /opt/inkweaver/uploads (卷映射)
                  → smtp.qq.com:465
```

### A.2 仓库内交付物

| 文件 | 说明 |
|------|------|
| [docker-compose.prod.yml](../docker-compose.prod.yml) | 生产 PG + Redis + Server（无 Mailhog） |
| [apps/server/Dockerfile](../apps/server/Dockerfile) | 多阶段构建 + 启动迁移 |
| [deploy/env.prod.example](../deploy/env.prod.example) | 复制为 `.env.prod` |
| [deploy/nginx/inkweaver.conf](../deploy/nginx/inkweaver.conf) | 单域名 Nginx |
| [deploy/scripts/](../deploy/scripts/) | 初始化、部署、备份、SSL |

### A.3 2G 内存注意

- 增加 **2GB swap**（`deploy/scripts/ecs-init.sh` 已包含）
- **勿在 ECS 上执行 `pnpm build`**；Web 在本地 `deploy/scripts/build-web-local.sh` 构建后 rsync

### A.4 环境变量（`.env.prod`）

与 [deploy/env.prod.example](../deploy/env.prod.example) 一致，重点：

| 变量 | 生产示例 |
|------|----------|
| `POSTGRES_PASSWORD` / `DB_PASSWORD` | 强密码，二者一致 |
| `REDIS_PASSWORD` | 强密码 |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `APP_PUBLIC_URL` | `https://app.你的域名.com` |
| `CORS_ORIGIN` | 同上 |
| `SMTP_HOST` | `smtp.qq.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_PASS` | QQ 邮箱 **授权码** |
| `UPLOADS_HOST_PATH` | `/opt/inkweaver/uploads` |

### A.5 上线命令摘要

```bash
# ECS 一次性
sudo bash deploy/scripts/ecs-init.sh

# 仓库根目录（服务器）
cp deploy/env.prod.example .env.prod   # 编辑后
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 本地机构建 Web
bash deploy/scripts/build-web-local.sh https://app.你的域名.com
bash deploy/scripts/deploy-web.sh root@ECS_IP

# Nginx + HTTPS
sudo bash deploy/scripts/setup-nginx-ssl.sh app.你的域名.com
```

### A.6 备份 cron

```cron
0 3 * * * /opt/inkweaver/repo/deploy/scripts/backup.sh >> /var/log/inkweaver-backup.log 2>&1
```

### A.7 验收

- `curl https://app.你的域名.com/readyz` → `redis: up`, `postgres: up`
- 忘记密码 → 真实邮箱收到重置信
- 见 [MVP_ACCEPTANCE.md](./MVP_ACCEPTANCE.md)

---

**文档版本**：1.1  
**最后更新**：2026-05-29
