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
  echo "  VITE_APP_PUBLIC_URL=https://app.yourdomain.com pnpm build:web"
  exit 1
fi

rsync -avz --delete "$DIST/" "$HOST:/opt/inkweaver/web/"
echo "==> Web 静态文件已同步到 $HOST:/opt/inkweaver/web/"
