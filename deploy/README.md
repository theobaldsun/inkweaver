# deploy

生产部署脚本与 Nginx 配置。完整步骤见 **[docs/部署迁移/部署运维.md](../docs/部署迁移/部署运维.md)**。

| 路径 | 说明 |
|------|------|
| `scripts/` | ECS 初始化、provision、Web 同步、备份 |
| `nginx/` | Nginx 站点配置 |
| `INSTANCE.local.example` | 实例 IP/域名/SSH 路径模板（复制为 `INSTANCE.local.md`，勿提交） |

生产环境变量：根目录 `.env.prod`（gitignore，变量说明见部署运维文档 §2.3）。
