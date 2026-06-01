#!/bin/bash
# 在开发机本地构建 Web（避免在 2G ECS 上 pnpm build）
# 用法：./deploy/scripts/build-web-local.sh https://app.yourdomain.com
set -euo pipefail

APP_URL="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export VITE_APP_PUBLIC_URL="${APP_URL:-http://localhost:3003}"

echo "==> VITE_APP_PUBLIC_URL=$VITE_APP_PUBLIC_URL"
pnpm install
pnpm build:packages 2>/dev/null || pnpm --filter @inkweaver/shared build
pnpm build:web

echo "==> 产物：apps/web/dist"
echo "==> 同步到 ECS：./deploy/scripts/deploy-web.sh user@your-ecs"
