# Ubuntu 服务器操作指令

本文面向 InkWeaver 单机 ECS 的日常学习和排障。示例中的主机、用户名和路径是占位符；执行删除、覆盖、数据库恢复、防火墙或服务重启前必须先确认目标。

## 1. 命令行基础

```bash
pwd                       # 当前目录
ls -lah                   # 包含隐藏文件的详细列表
cd /opt/inkweaver/repo    # 切换目录
cd ..                     # 上一级
history | tail -n 30      # 最近命令
clear                     # 清屏
```

常用帮助：

```bash
man systemctl
docker compose --help
command --help
```

## 2. 查看文件，不误改配置

```bash
cat file                  # 一次输出整个小文件
less file                 # 分页查看，q 退出
head -n 30 file
tail -n 100 file
tail -f /var/log/file.log # 持续跟踪，Ctrl+C 退出
stat file                 # 大小、权限、所有者、时间
file file                 # 文件类型
```

搜索：

```bash
grep -n 'AI_EMBED' .env.prod
grep -RIn 'keyword' /opt/inkweaver/repo/docs
find /opt/inkweaver -maxdepth 3 -type f -name '*.toml' -print
```

处理 `.env.prod` 时避免完整输出，因为其中含密码和 Token。优先只检查变量是否存在：

```bash
grep -q '^AI_EMBED_BASE_URL=' .env.prod && echo configured
```

## 3. 创建、复制和移动

```bash
mkdir -p /opt/inkweaver/config
touch example.txt
cp source target
cp -a source-dir target-dir
mv old-name new-name
install -m 600 source /opt/inkweaver/config/.env.prod
install -m 0755 frps /usr/local/bin/frps
```

`install` 会复制文件并同时设置权限/所有者。下载解压后的程序已经可以相对路径运行；复制到 `/usr/local/bin` 是为了建立稳定的系统命令路径。

不要用未解析的变量或宽泛通配符执行递归删除。删除前先列出完全相同的目标：

```bash
find /opt/inkweaver -maxdepth 1 -type d -name 'web.previous.*' -print
# 确认输出后，才对这些明确目录执行删除。
```

## 4. 权限和所有者

```bash
id
whoami
ls -ld /opt/inkweaver/web
stat -c '%U:%G %a %n' /opt/inkweaver/web
```

权限数字：

- `755`：所有者可写，其他用户可读和进入目录；适合 Web 目录。
- `644`：所有者可写，其他用户可读；适合静态文件。
- `600`：只有所有者可读写；适合 `.env.prod` 和 Token 文件。
- `700`：只有所有者可访问；适合秘密配置目录。

```bash
sudo chown -R admin:www-data /opt/inkweaver/web
sudo find /opt/inkweaver/web -type d -exec chmod 755 {} +
sudo find /opt/inkweaver/web -type f -exec chmod 644 {} +
sudo chmod 600 /opt/inkweaver/repo/.env.prod
```

不要对 `/opt`、`/` 或整个用户主目录盲目执行递归 `chmod`/`chown`。

## 5. sudo 与 root

```bash
sudo -n true && echo '免密 sudo 可用'
sudo command
sudo -u admin git -C /opt/inkweaver/repo status
```

- `sudo command`：以 root 权限运行单条命令。
- `sudo -u admin`：以指定普通用户运行，适合 Git 仓库所有权一致性。
- `sudo -n`：禁止密码交互；自动化脚本需要它快速失败，而不是卡住等待输入。

## 6. 进程、端口和资源

```bash
ps aux | grep frps
pgrep -a frps
top
free -h
uptime
df -h
df -i
du -sh /opt/inkweaver/*
```

端口：

```bash
sudo ss -lntp
sudo ss -lntp | grep -E ':3000|:7000|:18090'
```

诊断资源耗尽：

```bash
free -h
vmstat 1 5
docker stats --no-stream
journalctl -k -b --no-pager | grep -Ei 'oom|killed process|out of memory'
journalctl -k -b -1 --no-pager | grep -Ei 'oom|killed process|out of memory'
```

没有内核 OOM 记录时，不要把“服务器卡住”直接写成已证实的 OOM；CPU、I/O、网络或内存压力都需要证据。

## 7. systemd 服务

```bash
sudo systemctl status frps --no-pager
sudo systemctl is-active frps
sudo systemctl start frps
sudo systemctl restart frps
sudo systemctl stop frps
sudo systemctl enable frps
sudo systemctl disable frps
sudo systemctl daemon-reload
```

修改 unit 文件后先 `daemon-reload`，再 restart。

日志：

```bash
sudo journalctl -u frps -n 100 --no-pager
sudo journalctl -u nginx --since '30 minutes ago' --no-pager
sudo journalctl -u frps -f
```

## 8. UFW 防火墙

```bash
sudo ufw status verbose
sudo ufw status numbered
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow from 192.0.2.10 to any port 7000 proto tcp
```

删除规则时先看编号，再删除明确编号：

```bash
sudo ufw status numbered
sudo ufw delete 3
```

Docker bridge 到宿主机端口需要单独考虑来源网段和接口。宿主机本地 curl 成功不代表容器路径已经放行。

## 9. Nginx

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo systemctl reload nginx
sudo journalctl -u nginx -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
```

修改配置后始终先 `nginx -t`，通过后使用 `reload`；不必为普通配置更新执行硬重启。

静态资源：

```bash
curl -I https://app.example.com/
curl -I https://app.example.com/assets/actual-file.js
```

JS 返回 `text/html` 往往表示资源不存在却被 SPA fallback 返回了 `index.html`，或 Nginx 无法读取静态文件。

## 10. Docker 基础

```bash
docker version
docker info
docker ps
docker ps -a
docker images
docker stats --no-stream
docker logs inkweaver-server --tail 100
docker logs inkweaver-server --since 10m
docker inspect inkweaver-server
```

容器、镜像、volume 不同：

- 容器：某个镜像的运行实例。
- 镜像：只读应用文件层。
- volume：独立持久化数据；删除容器不应自动删除命名 volume。

不要用 `docker system prune -a --volumes` 解决普通磁盘问题。先用以下命令确认占用：

```bash
docker system df
docker image ls
docker volume ls
docker ps -a --size
```

## 11. Docker Compose

InkWeaver 生产命令应固定项目名、Compose 文件和环境文件：

```bash
cd /opt/inkweaver/repo

docker compose -p repo -f docker-compose.prod.yml --env-file .env.prod config
docker compose -p repo -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -p repo -f docker-compose.prod.yml --env-file .env.prod logs server --tail=100
```

仅重新创建 Server，不构建其他服务：

```bash
docker compose -p repo -f docker-compose.prod.yml --env-file .env.prod \
  up -d --no-build --force-recreate server
```

危险边界：

- `down` 会停止该 Compose 项目的全部服务。
- `down -v` 还会删除该项目的命名 volume，可能造成数据库数据丢失。
- 不带 `-p repo` 可能操作另一个项目名下的资源。
- `--build` 会触发构建，但不等于 `--no-cache`。

Shadowsocks 是同机独立容器，不属于 InkWeaver Compose。不要用全局容器清理或批量 stop 影响它。

## 12. Git 在服务器上的操作

```bash
sudo -u admin git -C /opt/inkweaver/repo status --short --branch
sudo -u admin git -C /opt/inkweaver/repo fetch origin
sudo -u admin git -C /opt/inkweaver/repo pull --ff-only origin master
sudo -u admin git -C /opt/inkweaver/repo log -5 --oneline
sudo -u admin git -C /opt/inkweaver/repo rev-parse HEAD
```

典型错误：

- `not a git repository`：目录没有 `.git`，需要确认是否从压缩包部署或曾替换目录。
- `dubious ownership`：执行 Git 的用户与仓库所有者不同。
- `pull` 被本地修改阻断：先检查差异归属，不要直接 `reset --hard`。

## 13. 网络检查

```bash
ip -brief address
ip route
getent hosts app.example.com
curl -v --max-time 10 https://app.example.com/readyz
nc -vz 127.0.0.1 3000
```

分清四层：

1. DNS 是否解析到预期地址；
2. TCP 端口是否能连接；
3. TLS/HTTP 是否成功；
4. 应用返回内容是否正确。

TCP `Connected` 不等于 HTTP 健康，HTTP 200 也不等于业务数据正确。

## 14. 压缩、校验和传输

```bash
tar -czf artifact.tar.gz directory
tar -tzf artifact.tar.gz | head
tar -xzf artifact.tar.gz -C target
sha256sum artifact.tar.gz
scp -i /path/to/key.pem artifact.tar.gz root@host:/tmp/
```

上传构建产物时，本地和远端 SHA-256 必须一致。不要直接覆盖正在运行的目录；先上传临时路径，验证后再切换。

## 15. 关机、重启与恢复顺序

```bash
sudo reboot
sudo shutdown -h now
```

重启生产实例属于外部高影响操作。重启后按顺序检查：

1. SSH；
2. Shadowsocks；
3. Docker daemon；
4. PostgreSQL、Redis、MinIO、Nest；
5. Nginx；
6. FRPS；
7. Windows 本机 frpc；
8. `/readyz`、`/api/ai/ping`、Web 静态资源和实际 AI/search 请求。

FRPS 重启后，Windows frpc 有时进程仍在但工作连接不可用，应重新启动 frpc 并观察日志。
