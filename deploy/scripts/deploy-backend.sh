#!/bin/bash
# 在 ECS 上构建并启动后端（于 /opt/inkweaver/repo 执行）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -f .env.prod ]; then
  echo "缺少 .env.prod，请先按 docs/运维.md 创建并编辑"
  exit 1
fi

export UPLOADS_HOST_PATH="${UPLOADS_HOST_PATH:-/opt/inkweaver/uploads}"
mkdir -p "$UPLOADS_HOST_PATH"

echo "==> 构建并启动容器"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo "==> 等待就绪"
sleep 5
curl -sf http://127.0.0.1:3000/readyz | head -c 500 || {
  echo "readyz 失败，查看日志：docker compose -f docker-compose.prod.yml logs server --tail=80"
  exit 1
}

echo "==> 后端部署完成"
