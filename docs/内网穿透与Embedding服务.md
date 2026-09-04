# FRP 内网穿透与本机 Embedding 服务

本文说明如何让 ECS 上的 Nest 容器调用运行在 Windows 开发机上的 embedding 服务，并提供不依赖历史会话的安装、配置、启动、验收和排障步骤。

## 1. 链路和端口

```text
Nest 容器
  └─ http://host.docker.internal:18090
       └─ ECS 宿主机 frps :18090
            └─ 加密 FRP 隧道（控制端口 :7000）
                 └─ Windows frpc
                      └─ http://127.0.0.1:8090 embedding 服务
```

| 端口 | 所在位置 | 用途 |
|------|----------|------|
| `8090` | Windows | embedding HTTP 服务，只监听 `127.0.0.1` |
| `7000` | ECS | frpc 登录 frps 的控制端口 |
| `18090` | ECS | FRP 映射出来的 embedding TCP 端口 |

7000 与 18090 不能混用。`Test-NetConnection <ECS> -Port 7000` 成功只证明控制端口可达，不证明 18090 已经建立代理。

## 2. 两套 Token 不是一回事

| Token | 保护的链路 | 配置位置 |
|-------|------------|----------|
| FRP auth token | frpc 登录 frps | `client_token`、`server_token` 及 FRP TOML |
| `EMBED_SERVICE_TOKEN` / `AI_EMBED_TOKEN` | Nest 调用 embedding HTTP API | Windows 环境变量、ECS `.env.prod` |

两者应分别生成，不要复用。文档和日志中不得打印真实值。

PowerShell 生成 64 位十六进制随机字符串并写入无 BOM 文件：

```powershell
$token = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
[System.IO.File]::WriteAllText(
  'C:\frp\client_token',
  $token,
  [System.Text.UTF8Encoding]::new($false)
)
Get-Item 'C:\frp\client_token' | Select-Object FullName, Length
```

第一行只把 Token 放入当前 PowerShell 变量；不会自动显示，也不会写文件。第二段才真正创建 `client_token`。不要用 `Get-Content` 把 Token 输出到共享日志。

ECS `/etc/frp/server_token` 必须包含相同的 FRP Token。HTTP Token 则分别放在 Windows 的 `EMBED_SERVICE_TOKEN` 和 ECS `.env.prod` 的 `AI_EMBED_TOKEN`。

## 3. 下载正确的 FRP 包

文件名中的操作系统必须与运行环境一致：

| 运行环境 | 包名示例 |
|----------|----------|
| Windows x64 | `frp_<version>_windows_amd64.zip` |
| Ubuntu/Linux x64 | `frp_<version>_linux_amd64.tar.gz` |
| Intel Mac | `frp_<version>_darwin_amd64.tar.gz` |

Darwin 二进制不能在 Windows 或 Linux 运行。Windows 可执行文件应为 `frpc.exe`；Linux/Darwin 通常没有 `.exe` 后缀。

Linux 下载解压后已经可以用相对路径运行：

```bash
./frp_<version>_linux_amd64/frps -c ./frps.toml
```

下面的命令不是“第二次安装”，而是把二进制复制到标准系统路径、设置执行权限，便于 systemd 和任意目录调用：

```bash
sudo install -m 0755 frp_<version>_linux_amd64/frps /usr/local/bin/frps
```

## 4. ECS 配置 frps

目录：

```bash
sudo install -d -m 700 /etc/frp
sudo install -m 600 /path/to/server_token /etc/frp/server_token
```

`/etc/frp/frps.toml`：

```toml
bindAddr = "0.0.0.0"
bindPort = 7000
proxyBindAddr = "0.0.0.0"

allowPorts = [
  { single = 18090 }
]

auth.method = "token"
auth.tokenSource.type = "file"
auth.tokenSource.file.path = "/etc/frp/server_token"

transport.tls.force = true
```

`/etc/systemd/system/frps.service`：

```ini
[Unit]
Description=InkWeaver FRP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

验证并启动：

```bash
sudo /usr/local/bin/frps verify -c /etc/frp/frps.toml
sudo systemctl daemon-reload
sudo systemctl enable --now frps
sudo systemctl status frps --no-pager
sudo journalctl -u frps -n 100 --no-pager
sudo ss -lntp | grep ':7000'
```

## 5. Windows 配置 frpc

建议目录：

```text
C:\frp\frpc.exe
C:\frp\frpc.toml
C:\frp\client_token
```

`C:\frp\frpc.toml`：

```toml
serverAddr = "YOUR_ECS_PUBLIC_IP"
serverPort = 7000

auth.method = "token"
auth.tokenSource.type = "file"
auth.tokenSource.file.path = "C:/frp/client_token"

transport.protocol = "tcp"
transport.tls.enable = true

[[proxies]]
name = "inkweaver-embed"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8090
remotePort = 18090
```

`tcpMux` 默认开启，通常无需写入配置。`transport.tcpMux = false` 只适合针对代理链、连接复用兼容性或抓包排查进行临时验证，不是连接成功的必备项；修改后应观察连接数和 frps/frpc 日志。

配置验证：

```powershell
Set-Location C:\frp
.\frpc.exe verify -c .\frpc.toml
```

输出 `syntax is ok` 就表示配置语法验证成功，不需要额外出现 `success`。

前台启动：

```powershell
.\frpc.exe -c .\frpc.toml
```

只有出现登录成功、代理启动成功，并且 ECS 开始监听 18090，才表示完整隧道建立。只通过 `verify` 不代表已经连接服务器。

## 6. 启动本机 embedding 服务

PowerShell：

```powershell
Set-Location D:\path\to\SyncBox-AI\services\embed-service
.\.venv\Scripts\Activate.ps1
$env:EMBED_SERVICE_TOKEN = 'replace-with-http-token'
uvicorn app:app --host 127.0.0.1 --port 8090
```

另开窗口验证：

```powershell
$headers = @{ Authorization = "Bearer $env:EMBED_SERVICE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8090/health -Headers $headers
```

不要把尖括号写进真实请求：

```bash
# 错误：尖括号是文档占位符，Shell 还可能把它解释为重定向
curl -H 'Authorization: Bearer <TOKEN>' ...

# 正确：从环境变量读取
curl -H "Authorization: Bearer $EMBED_SERVICE_TOKEN" http://127.0.0.1:8090/health
```

## 7. 防火墙和安全组

### 7.1 云安全组

- 7000/TCP：允许 frpc 所在网络访问；若本地公网 IP 会变化，及时更新规则。
- 18090/TCP：不要向公网开放。它只供 ECS 宿主机和本机 Docker bridge 使用。
- 80/443：供 Nginx。
- 22：尽量限制管理来源。

`192.168.x.x`、`172.16.0.0/12` 等是内网地址，不是公网 IP。家庭宽带是否有固定公网 IP 由运营商决定；动态公网地址可用 DDNS，但云安全组仍需考虑地址变化。

### 7.2 UFW 与 Docker bridge

宿主机访问 `127.0.0.1:18090` 成功，不代表 Nest 容器能访问宿主机。先找 Compose 网络和 bridge：

```bash
docker network ls | grep inkweaver
docker network inspect repo_inkweaver_internal \
  --format '{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}'
ip -brief link | grep '^br-'
```

按实际网段和 bridge 添加最窄规则，例如：

```bash
sudo ufw allow in on br-xxxxxxxxxxxx from 172.18.0.0/16 to any port 18090 proto tcp
sudo ufw status numbered
```

Compose 网络重建后 bridge 名称或网段可能变化，需要重新核对。不要因为容器访问失败就直接把 18090 对全网开放。

## 8. Nest 生产配置

`/opt/inkweaver/repo/.env.prod`：

```env
AI_EMBED_BASE_URL=http://host.docker.internal:18090
AI_EMBED_TOKEN=replace-with-http-token
AI_EMBED_TIMEOUT_MS=60000
```

`docker-compose.prod.yml` 已配置：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

修改 `.env.prod` 后必须重新创建 Server 容器，单纯重启旧进程不能保证 Compose 环境变量更新：

```bash
docker compose -p repo -f docker-compose.prod.yml --env-file .env.prod \
  up -d --no-build --force-recreate server
```

## 9. 按层验收

不要跳层。前一层失败时，后一层的错误通常只是连锁结果。

### 9.1 Windows embedding

```powershell
Test-NetConnection 127.0.0.1 -Port 8090
Invoke-RestMethod http://127.0.0.1:8090/health -Headers $headers
```

### 9.2 Windows 到 FRPS 控制端口

```powershell
Test-NetConnection YOUR_ECS_PUBLIC_IP -Port 7000
```

### 9.3 FRPS 监听

```bash
sudo ss -lntp | grep -E ':7000|:18090'
sudo journalctl -u frps -n 100 --no-pager
```

18090 只有在代理注册成功后才会监听。

### 9.4 ECS 宿主机访问代理

```bash
export AI_EMBED_TOKEN='replace-with-http-token'
curl -fsS \
  -H "Authorization: Bearer $AI_EMBED_TOKEN" \
  http://127.0.0.1:18090/health
unset AI_EMBED_TOKEN
```

### 9.5 Nest 容器访问宿主机

```bash
docker exec inkweaver-server node -e '
fetch(process.env.AI_EMBED_BASE_URL + "/health", {
  headers: { Authorization: "Bearer " + process.env.AI_EMBED_TOKEN }
}).then(async r => { console.log(r.status, await r.text()) })
  .catch(e => { console.error(e); process.exit(1) })'
```

### 9.6 应用接口

```bash
curl -fsS https://app.example.com/api/ai/ping
```

`/api/search/hybrid` 需要登录 Token；匿名 401 是预期行为。

## 10. 典型故障

### `frpc.exe` 无法识别

先确认下载的是 Windows 包，并进入包含 `frpc.exe` 的目录：

```powershell
Get-ChildItem C:\frp
Set-Location C:\frp
.\frpc.exe verify -c .\frpc.toml
```

如果目录中只有无后缀的 `frpc`，很可能下载了 Linux 或 Darwin 包。

### `connection write timeout`

7000 的 TCP 探测成功但 frpc 登录仍超时，应检查：

1. frps 日志是否收到连接；
2. 云安全组/NAT/运营商链路是否中断；
3. 两端 FRP 主版本和 TLS/auth 配置是否一致；
4. 是否有系统级代理、杀毒或透明代理拦截；
5. Token 文件是否可读、内容一致且没有 BOM/换行污染。

清空 `http_proxy` 对纯 TCP FRP 不一定有效；不能把所有超时都归因于 HTTP 代理。

### `EOF`

通常表示 TCP 已连接但对端主动关闭。优先看同一时间的 frps 日志，并比较 TLS、Token 和协议版本，而不是反复修改 remotePort。

### 进程在、Established 也在，但请求超时

FRP 控制连接可能仍显示存活，但工作连接池已失效。特别是 ECS/frps 重启后，Windows frpc 可能没有正确恢复。重启本机 frpc，再观察新的登录和代理注册日志：

```powershell
Get-Process frpc -ErrorAction SilentlyContinue | Stop-Process
Set-Location C:\frp
.\frpc.exe -c .\frpc.toml
```

### ECS 18090 正常，Nest 仍超时

这是宿主机路径与 Docker bridge 路径的差异。检查 `host.docker.internal` 解析、Compose `extra_hosts`、实际 bridge 网段及 UFW 规则。

### 电脑休眠或重启后 AI 不可用

embedding 和 frpc 都在本机，电脑休眠会中断生产 RAG。当前 frpc 若只是前台进程，Windows 重启后必须手动启动。长期生产应迁移到常驻服务或云 embedding；在此之前可使用 Windows Task Scheduler/服务包装器实现登录后自启，但安装和权限配置应单独评审。
