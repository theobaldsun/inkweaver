#!/bin/bash
# 将本地构建的 Web 静态资源同步到 ECS（在开发机执行）
# 用法：./deploy/scripts/deploy-web.sh user@your-ecs-ip
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 user@ecs-host"
  exit 1
fi

HOST="$1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/apps/web/dist"

if [ ! -d "$DIST" ]; then
  echo "未找到 $DIST，请先在本机构建："
  echo "  bash deploy/scripts/build-web-local.sh https://app.yourdomain.com"
  exit 1
fi

rsync -avz --delete "$DIST/" "$HOST:/opt/inkweaver/web/"
# scp/rsync 可能把 assets 目录落成 700，nginx(www-data) 读不到会回退 index.html → MIME 报错
ssh "$HOST" "find /opt/inkweaver/web -type d -exec chmod 755 {} \\; && find /opt/inkweaver/web -type f -exec chmod 644 {} \\;"
echo "==> Web 静态文件已同步到 $HOST:/opt/inkweaver/web/（已修正目录权限）"
