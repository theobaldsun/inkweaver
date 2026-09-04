#!/usr/bin/env bash
# 在开发机本地构建 Web，避免在低内存 ECS 上安装依赖或执行 Vite 构建。
# 用法：bash deploy/scripts/build-web-local.sh https://app.example.com
set -Eeuo pipefail

usage() {
  cat <<'EOF'
用法: bash deploy/scripts/build-web-local.sh [APP_URL]

APP_URL 默认值为 http://localhost:3003。Windows 请在 Git Bash 中执行，
不要调用依赖 WSL 的 C:\Windows\System32\bash.exe。
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

for command_name in node pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少命令：$command_name。请先在开发机安装项目要求的 Node.js/pnpm 环境。" >&2
    exit 1
  fi
done

APP_URL="${1:-http://localhost:3003}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/apps/web/dist"
cd "$ROOT"

export VITE_APP_PUBLIC_URL="$APP_URL"

echo "==> 在开发机安装锁定依赖"
pnpm install --frozen-lockfile

echo "==> VITE_APP_PUBLIC_URL=$VITE_APP_PUBLIC_URL"
# 发布构建必须绕过 Turbo 缓存，避免 VITE_APP_PUBLIC_URL 变化后继续复用旧 dist。
# Turbo 的 build 任务带有 ^build 依赖，会先构建 Web 所需 workspace 包。
pnpm exec turbo run build --filter=@inkweaver/web --force

if [ ! -s "$DIST/index.html" ]; then
  echo "构建失败：未生成 $DIST/index.html" >&2
  exit 1
fi

if [ ! -d "$DIST/assets" ] || ! find "$DIST/assets" -type f -print -quit | grep -q .; then
  echo "构建失败：$DIST/assets 不存在或没有静态资源" >&2
  exit 1
fi

FILE_COUNT="$(find "$DIST" -type f | wc -l | tr -d '[:space:]')"
DIST_SIZE="$(du -sh "$DIST" | awk '{print $1}')"

echo "==> Web 构建完成：apps/web/dist（${FILE_COUNT} 个文件，${DIST_SIZE}）"
echo "==> 部署示例：bash deploy/scripts/deploy-web.sh user@your-ecs /path/to/key.pem"
