#!/usr/bin/env bash
# 从开发机上传 Web 静态资源。Windows 请在 Git Bash 中执行。
set -Eeuo pipefail

usage() {
  cat <<'EOF'
用法: bash deploy/scripts/deploy-web.sh user@ecs-host [identity_file] [health_url]

可选环境变量：
  SSH_PORT=22
  WEB_REMOTE_ROOT=/opt/inkweaver/web
  WEB_HEALTH_URL=https://app.example.com
  WEB_DIST_DIR=/path/to/dist

流程：本地打包 -> scp 上传 -> SHA-256 校验 -> 临时目录解压 -> 切换目录
      -> HTTP 验收 -> 成功后清除所有 Web 历史备份；失败则恢复旧目录。
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  usage >&2
  exit 2
fi

HOST="$1"
IDENTITY_FILE="${2:-${SSH_IDENTITY_FILE:-}}"
HEALTH_URL="${3:-${WEB_HEALTH_URL:-}}"
SSH_PORT="${SSH_PORT:-22}"
WEB_ROOT="${WEB_REMOTE_ROOT:-/opt/inkweaver/web}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="${WEB_DIST_DIR:-$ROOT/apps/web/dist}"
REMOTE_HELPER_SOURCE="$ROOT/deploy/scripts/lib/deploy-web-remote.sh"

case "$HOST" in
  ''|*[[:space:]]*) echo "非法主机参数：$HOST" >&2; exit 2 ;;
esac
case "$SSH_PORT" in
  ''|*[!0-9]*) echo "SSH_PORT 必须是数字" >&2; exit 2 ;;
esac
case "$WEB_ROOT" in
  /opt/*/web|/srv/*/web) ;;
  *) echo "WEB_REMOTE_ROOT 只允许 /opt/<app>/web 或 /srv/<app>/web" >&2; exit 2 ;;
esac

if [ ! -s "$DIST/index.html" ] || [ ! -d "$DIST/assets" ]; then
  echo "Web 产物不完整：$DIST" >&2
  echo "请先执行：bash deploy/scripts/build-web-local.sh https://app.yourdomain.com" >&2
  exit 1
fi

if ! find "$DIST/assets" -type f -print -quit | grep -q .; then
  echo "Web 产物不完整：assets 目录为空" >&2
  exit 1
fi

[ -f "$REMOTE_HELPER_SOURCE" ] || {
  echo "缺少远端部署辅助脚本：$REMOTE_HELPER_SOURCE" >&2
  exit 1
}

for command_name in tar sha256sum ssh scp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少命令：$command_name。Windows 请使用 Git Bash。" >&2
    exit 1
  fi
done

if [ -n "$HEALTH_URL" ] && ! command -v curl >/dev/null 2>&1; then
  echo "配置了 health_url，但本机缺少 curl" >&2
  exit 1
fi

if [ -n "$IDENTITY_FILE" ] && [ ! -f "$IDENTITY_FILE" ]; then
  echo "SSH 私钥不存在：$IDENTITY_FILE" >&2
  exit 1
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=15 -p "$SSH_PORT")
SCP_ARGS=(-o BatchMode=yes -o ConnectTimeout=15 -P "$SSH_PORT")
if [ -n "$IDENTITY_FILE" ]; then
  SSH_ARGS+=(-i "$IDENTITY_FILE")
  SCP_ARGS+=(-i "$IDENTITY_FILE")
fi

TMP_DIR="$(mktemp -d)"
ARCHIVE="$TMP_DIR/inkweaver-web.tar.gz"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
REMOTE_ARCHIVE="/tmp/inkweaver-web-${RELEASE_ID}.tar.gz"
REMOTE_HELPER="/tmp/inkweaver-deploy-web-${RELEASE_ID}.sh"
PREPARED=0

cleanup() {
  local exit_code="$?"
  if [ "$PREPARED" -eq 1 ]; then
    rollback >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_DIR"
  ssh "${SSH_ARGS[@]}" "$HOST" "rm -f -- $REMOTE_ARCHIVE $REMOTE_HELPER" >/dev/null 2>&1 || true
  return "$exit_code"
}
trap cleanup EXIT

rollback() {
  if [ "$PREPARED" -eq 1 ]; then
    echo "==> 验收失败，恢复发布前 Web"
    ssh "${SSH_ARGS[@]}" "$HOST" \
      "bash $REMOTE_HELPER rollback $WEB_ROOT $RELEASE_ID" || true
    PREPARED=0
  fi
}

check_public_web() {
  local index_file asset_path
  index_file="$TMP_DIR/public-index.html"

  curl --fail --silent --show-error --location --max-time 20 "$HEALTH_URL" > "$index_file"
  grep -qi '<!doctype html' "$index_file" || {
    echo "健康检查返回内容不是 HTML：$HEALTH_URL" >&2
    return 1
  }

  asset_path="$(grep -oE '/assets/[^"'"'"'?# ]+\.(js|css)' "$index_file" | head -n 1 || true)"
  [ -n "$asset_path" ] || {
    echo "健康检查页面没有引用 /assets 下的 JS/CSS" >&2
    return 1
  }

  curl --fail --silent --show-error --location --max-time 20 \
    --output /dev/null "${HEALTH_URL%/}${asset_path}"
}

echo "==> 打包 Web 产物"
tar -czf "$ARCHIVE" -C "$DIST" .
ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"

echo "==> 上传到 $HOST"
scp "${SCP_ARGS[@]}" "$ARCHIVE" "$HOST:$REMOTE_ARCHIVE"
scp "${SCP_ARGS[@]}" "$REMOTE_HELPER_SOURCE" "$HOST:$REMOTE_HELPER"

echo "==> 校验并切换远端 Web 目录"
PREPARED=1
ssh "${SSH_ARGS[@]}" "$HOST" \
  "bash $REMOTE_HELPER prepare $REMOTE_ARCHIVE $WEB_ROOT $ARCHIVE_SHA $RELEASE_ID"

if [ -n "$HEALTH_URL" ]; then
  echo "==> 验证首页和静态资源：$HEALTH_URL"
  if ! check_public_web; then
    rollback
    exit 1
  fi
else
  echo "==> 未配置 WEB_HEALTH_URL，仅完成远端文件结构验证"
fi

echo "==> 提交发布并清除所有历史 Web 备份"
ssh "${SSH_ARGS[@]}" "$HOST" \
  "bash $REMOTE_HELPER commit $WEB_ROOT $RELEASE_ID"
PREPARED=0

echo "==> Web 部署完成：$HOST:$WEB_ROOT"
