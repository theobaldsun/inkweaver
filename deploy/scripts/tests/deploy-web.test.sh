#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
REMOTE_HELPER="$ROOT/deploy/scripts/lib/deploy-web-remote.sh"
DEPLOY_SCRIPT="$ROOT/deploy/scripts/deploy-web.sh"
BUILD_SCRIPT="$ROOT/deploy/scripts/build-web-local.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  grep -Fq "$2" "$1" || fail "$1 不包含：$2"
}

make_archive() {
  local label="$1" source_dir="$2" archive="$3"
  mkdir -p "$source_dir/assets"
  printf '<!doctype html><script src="/assets/index.js"></script>%s\n' "$label" > "$source_dir/index.html"
  printf 'console.log(%q)\n' "$label" > "$source_dir/assets/index.js"
  tar -czf "$archive" -C "$source_dir" .
}

echo "[1/5] Bash 语法"
bash -n "$BUILD_SCRIPT" "$DEPLOY_SCRIPT" "$REMOTE_HELPER"

echo "[2/5] 参数和产物校验"
if bash "$DEPLOY_SCRIPT" >"$TMP_DIR/no-args.log" 2>&1; then
  fail "deploy-web.sh 无参数时应失败"
fi
assert_file_contains "$TMP_DIR/no-args.log" "用法"

if WEB_DIST_DIR="$TMP_DIR/missing" bash "$DEPLOY_SCRIPT" test@example >"$TMP_DIR/missing.log" 2>&1; then
  fail "dist 缺失时应失败"
fi
assert_file_contains "$TMP_DIR/missing.log" "产物不完整"

echo "[3/5] prepare + commit 清理全部历史备份"
WEB_ROOT="$TMP_DIR/commit/web"
mkdir -p "$WEB_ROOT/assets" "$TMP_DIR/commit/web.previous.older" "$TMP_DIR/commit/web.backup.older"
printf '<!doctype html>old\n' > "$WEB_ROOT/index.html"
printf old > "$WEB_ROOT/assets/index.js"
ARCHIVE="$TMP_DIR/commit.tar.gz"
make_archive new "$TMP_DIR/new-commit" "$ARCHIVE"
SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
INKWEAVER_DEPLOY_TESTING=1 bash "$REMOTE_HELPER" prepare "$ARCHIVE" "$WEB_ROOT" "$SHA" release-1
assert_file_contains "$WEB_ROOT/index.html" "new"
[ -d "$TMP_DIR/commit/web.previous.release-1" ] || fail "未生成本次回滚目录"
INKWEAVER_DEPLOY_TESTING=1 bash "$REMOTE_HELPER" commit "$WEB_ROOT" release-1
[ "$(find "$TMP_DIR/commit" -mindepth 1 -maxdepth 1 -name 'web.*' | wc -l | tr -d '[:space:]')" = "0" ] || fail "成功后仍残留历史备份"

echo "[4/5] prepare + rollback 恢复旧版本"
WEB_ROOT="$TMP_DIR/rollback/web"
mkdir -p "$WEB_ROOT/assets"
printf '<!doctype html>stable-old\n' > "$WEB_ROOT/index.html"
printf old > "$WEB_ROOT/assets/index.js"
ARCHIVE="$TMP_DIR/rollback.tar.gz"
make_archive broken-new "$TMP_DIR/new-rollback" "$ARCHIVE"
SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
INKWEAVER_DEPLOY_TESTING=1 bash "$REMOTE_HELPER" prepare "$ARCHIVE" "$WEB_ROOT" "$SHA" release-2
INKWEAVER_DEPLOY_TESTING=1 bash "$REMOTE_HELPER" rollback "$WEB_ROOT" release-2
assert_file_contains "$WEB_ROOT/index.html" "stable-old"
[ "$(find "$TMP_DIR/rollback" -mindepth 1 -maxdepth 1 -name 'web.*' | wc -l | tr -d '[:space:]')" = "0" ] || fail "回滚后仍残留临时目录"

echo "[5/5] SHA-256 不匹配时拒绝发布"
WEB_ROOT="$TMP_DIR/checksum/web"
mkdir -p "$WEB_ROOT/assets"
printf '<!doctype html>unchanged\n' > "$WEB_ROOT/index.html"
printf old > "$WEB_ROOT/assets/index.js"
if INKWEAVER_DEPLOY_TESTING=1 bash "$REMOTE_HELPER" prepare "$ARCHIVE" "$WEB_ROOT" \
  0000000000000000000000000000000000000000000000000000000000000000 release-3 \
  >"$TMP_DIR/checksum.log" 2>&1; then
  fail "SHA-256 不匹配时应失败"
fi
assert_file_contains "$WEB_ROOT/index.html" "unchanged"
assert_file_contains "$TMP_DIR/checksum.log" "SHA-256 校验失败"

echo "PASS: deploy-web tests"
