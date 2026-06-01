# InkWeaver 单机阿里云部署

适用于 **2C2G ECS + Ubuntu 22.04 + 单域名**，成本仅服务器与域名。

## 快速清单

| 步骤 | 位置 | 命令 |
|------|------|------|
| 1. 初始化 ECS | 服务器 | `sudo bash deploy/scripts/ecs-init.sh` |
| 2. 同步代码 | 服务器 `/opt/inkweaver/repo` | `git clone` 或 `rsync` |
| 3. 配置环境 | 仓库根目录 | `cp deploy/env.prod.example .env.prod` 并编辑 |
| 4. 启动后端 | 仓库根目录 | `bash deploy/scripts/deploy-backend.sh` |
| 5. 构建 Web | **本地** | `bash deploy/scripts/build-web-local.sh https://app.你的域名.com` |
| 6. 上传 Web | 本地 | `bash deploy/scripts/deploy-web.sh user@ECS_IP` |
| 7. Nginx + SSL | 服务器 | `sudo bash deploy/scripts/setup-nginx-ssl.sh app.你的域名.com` |
| 8. 备份 cron | 服务器 | `0 3 * * * /opt/inkweaver/repo/deploy/scripts/backup.sh` |

## QQ 邮箱 SMTP

1. QQ 邮箱 → 设置 → 账户 → 开启 SMTP → 生成**授权码**
2. `.env.prod` 填写：
   - `SMTP_HOST=smtp.qq.com`
   - `SMTP_PORT=465`
   - `SMTP_SECURE=true`
   - `SMTP_PASS=授权码`（不是 QQ 密码）

## 文件存储

上传文件保存在宿主机 `/opt/inkweaver/uploads`（映射容器 `/app/uploads`），无需云 OSS。

## 详细说明

见 [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) 附录 A。
