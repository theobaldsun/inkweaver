# deploy

生产部署脚本与 Nginx 配置。完整发布、低内存约束、验收和回滚见
[部署与发布](../docs/部署与发布.md)，日常排障见 [运维](../docs/运维.md)。

| 路径 | 说明 |
|------|------|
| `scripts/build-web-local.sh` | 在开发机 Git Bash 中安装锁定依赖并构建 Web |
| `scripts/deploy-web.sh` | 使用 tar/scp/ssh 校验、切换和验收 Web，不依赖 rsync |
| `scripts/lib/deploy-web-remote.sh` | Web 部署的远端受控切换与回滚辅助脚本 |
| `scripts/tests/deploy-web.test.sh` | Web 部署脚本回归测试 |
| `scripts/` 其他文件 | ECS 初始化、provision、Server 部署、备份 |
| `nginx/` | Nginx 站点配置 |
| `INSTANCE.local.example` | 实例 IP/域名/SSH 路径模板（复制为 `INSTANCE.local.md`，勿提交） |

生产环境变量：根目录 `.env.prod`（gitignore，变量说明见运维文档）。

## Web 发布

Windows 必须在 Git Bash 执行：

```bash
bash deploy/scripts/build-web-local.sh https://app.example.com
bash deploy/scripts/deploy-web.sh \
  root@your-ecs \
  /c/Users/you/Desktop/server.pem \
  https://app.example.com
```

成功发布后清除全部历史 Web 发布备份；健康检查失败时自动恢复本次发布前目录。
脚本不操作 Docker Compose、Nest、数据库、FRP 或 Shadowsocks。

运行回归测试：

```bash
bash deploy/scripts/tests/deploy-web.test.sh
```

当前低内存 ECS 不应直接运行 Web 构建或 Server `build --no-cache`。`deploy-backend.sh`
只适用于资源充足、明确允许服务器构建的环境，不能作为当前 ECS 的默认入口。
