# InkWeaver 本机嵌入服务

CPU 上运行 `BAAI/bge-small-zh-v1.5`（512 维），供阿里云 Nest 通过 HTTP / FRP 调用。

## Windows PowerShell 启动

```powershell
Set-Location services/embed-service
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:EMBED_SERVICE_TOKEN = 'change-me'
uvicorn app:app --host 127.0.0.1 --port 8090
```

Linux/macOS：

```bash
cd services/embed-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export EMBED_SERVICE_TOKEN='change-me'
uvicorn app:app --host 127.0.0.1 --port 8090
```

探活：`GET http://127.0.0.1:8090/health`（若配置了 Token，需带 `Authorization: Bearer ...`）

嵌入：`POST http://127.0.0.1:8090/embed` body `{"texts":["你好"]}`

## Nest 环境变量（apps/server/.env 或 .env.prod）

```env
AI_EMBED_BASE_URL=http://127.0.0.1:8090
AI_EMBED_TOKEN=change-me
AI_EMBED_TIMEOUT_MS=60000
AI_CHAT_BASE_URL=https://api.deepseek.com/v1
AI_CHAT_API_KEY=sk-...
AI_CHAT_MODEL=deepseek-chat
```

生产经当前 FRP TCP 映射时，Nest 容器使用：

```env
AI_EMBED_BASE_URL=http://host.docker.internal:18090
```

完整的 Windows frpc、Ubuntu frps、Token 文件、UFW/Docker bridge 与逐层验收见
[FRP 内网穿透与本机 Embedding 服务](../../docs/内网穿透与Embedding服务.md)。

## FRP 安全约定

1. **必须**设置 `EMBED_SERVICE_TOKEN`，与 Nest `AI_EMBED_TOKEN` 一致。
2. frps 若部署在 ECS：仅开放必要端口；优先 TLS / frp 加密。
3. 云安全组只向本机网络开放 frps 控制端口 7000，不向公网开放映射端口 18090。
4. 笔记本休眠则 RAG 不可用——属开发/个人验证期预期；上线前可把 `AI_EMBED_BASE_URL` 切到云端 Embedding，业务代码无需改。

FRP 0.71 使用 TOML；不要混用旧版 INI 示例。当前链路使用 TCP proxy：Windows
`127.0.0.1:8090` 映射到 ECS `18090`。

## 维度锁定

输出维度固定 **512**。更换模型必须同步修改：

- `services/embed-service` 的 `EMBED_MODEL_NAME` / `EMBED_DIMENSIONS`
- Nest `AI_EMBEDDING_DIMENSIONS` 与 `document_chunks.embedding vector(N)` 迁移
- **全量重嵌入**
