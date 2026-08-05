# InkWeaver 本机嵌入服务

CPU 上运行 `BAAI/bge-small-zh-v1.5`（512 维），供阿里云 Nest 通过 HTTP / FRP 调用。

## 本地启动

```bash
cd services/embed-service
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt

set EMBED_SERVICE_TOKEN=change-me   # PowerShell: $env:EMBED_SERVICE_TOKEN="change-me"
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

生产经 FRP 时，将 `AI_EMBED_BASE_URL` 改为 ECS 可访问的 frp 映射地址（如 `https://embed.example.com`）。

## FRP 安全约定

1. **必须**设置 `EMBED_SERVICE_TOKEN`，与 Nest `AI_EMBED_TOKEN` 一致。
2. frps 若部署在 ECS：仅开放必要端口；优先 TLS / frp 加密。
3. 尽量限制来源为 ECS 出口 IP（防火墙 / frp allow）。
4. 笔记本休眠则 RAG 不可用——属开发/个人验证期预期；上线前可把 `AI_EMBED_BASE_URL` 切到云端 Embedding，业务代码无需改。

示例 frpc 片段（按你的 frps 调整）：

```ini
[inkweaver-embed]
type = http
local_ip = 127.0.0.1
local_port = 8090
custom_domains = embed.example.com
```

## 维度锁定

输出维度固定 **512**。更换模型必须同步修改：

- `services/embed-service` 的 `EMBED_MODEL_NAME` / `EMBED_DIMENSIONS`
- Nest `AI_EMBEDDING_DIMENSIONS` 与 `document_chunks.embedding vector(N)` 迁移
- **全量重嵌入**
