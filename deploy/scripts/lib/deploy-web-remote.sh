#!/usr/bin/env bash
# deploy-web.sh 上传到远端后调用的受控 Web 目录切换脚本。
set -Eeuo pipefail

fail() {
  echo "deploy-web-remote: $*" >&2
  exit 1
}

is_test_mode() {
  [ "${INKWEAVER_DEPLOY_TESTING:-0}" = "1" ]
}

run_root() {
  if is_test_mode || [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || fail "当前用户不是 root，且服务器没有 sudo"
    sudo -n "$@" || fail "需要免密 sudo；请改用 root 或为部署用户配置受限的 sudo 权限"
  fi
}

validate_release_id() {
  case "$1" in
    ''|*[!0-9A-Za-z._-]*) fail "非法 release id" ;;
  esac
}

validate_web_root() {
  local web_root="$1"

  if is_test_mode; then
    case "$web_root" in
      /*/web) return 0 ;;
      *) fail "测试目录必须是绝对路径且以 /web 结尾" ;;
    esac
  fi

  case "$web_root" in
    /opt/*/web|/srv/*/web) ;;
    *) fail "WEB_REMOTE_ROOT 只允许 /opt/<app>/web 或 /srv/<app>/web" ;;
  esac
}

history_paths() {
  local web_root="$1"
  local parent base
  parent="$(dirname "$web_root")"
  base="$(basename "$web_root")"

  run_root find "$parent" -mindepth 1 -maxdepth 1 \
    \( \
      \( -type d \( -name "${base}.previous.*" -o -name "${base}.backup.*" \
         -o -name "${base}.release.*" -o -name "${base}.failed.*" \) \) \
      -o \( -type f -name "${base}.state.*" \) \
    \) -print
}

remove_history() {
  local web_root="$1"
  local candidate

  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      "${web_root}.previous."*|"${web_root}.backup."*|"${web_root}.release."*|"${web_root}.failed."*|"${web_root}.state."*)
        run_root rm -rf -- "$candidate"
        ;;
      *) fail "拒绝删除未通过路径校验的目录：$candidate" ;;
    esac
  done < <(history_paths "$web_root")
}

prepare_release() {
  [ "$#" -eq 4 ] || fail "prepare 参数数量错误"
  local archive="$1" web_root="$2" expected_sha="$3" release_id="$4"
  local release_dir backup_dir state_file actual_sha owner archive_entry

  validate_web_root "$web_root"
  validate_release_id "$release_id"
  [ -f "$archive" ] || fail "上传包不存在：$archive"
  case "$expected_sha" in
    *[!0-9a-fA-F]*|'') fail "非法 SHA-256" ;;
  esac
  [ "${#expected_sha}" -eq 64 ] || fail "SHA-256 长度错误"

  actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
  [ "$actual_sha" = "$expected_sha" ] || fail "上传包 SHA-256 校验失败"

  while IFS= read -r archive_entry; do
    case "$archive_entry" in
      /*|../*|*/../*|*/..) fail "压缩包包含越界路径：$archive_entry" ;;
    esac
  done < <(tar -tzf "$archive")

  release_dir="${web_root}.release.${release_id}"
  backup_dir="${web_root}.previous.${release_id}"
  state_file="${web_root}.state.${release_id}"

  [ ! -e "$release_dir" ] || fail "临时发布目录已存在：$release_dir"
  [ ! -e "$backup_dir" ] || fail "本次回滚目录已存在：$backup_dir"
  [ ! -e "$state_file" ] || fail "本次状态文件已存在：$state_file"

  owner="www-data:www-data"
  if run_root test -e "$web_root"; then
    owner="$(run_root stat -c '%U:%G' "$web_root")"
  fi

  run_root mkdir -p "$release_dir"
  run_root tar -xzf "$archive" -C "$release_dir"
  run_root test -s "$release_dir/index.html" || fail "新产物缺少 index.html"
  run_root test -d "$release_dir/assets" || fail "新产物缺少 assets 目录"
  run_root find "$release_dir/assets" -type f -print -quit | grep -q . || fail "assets 目录为空"

  run_root find "$release_dir" -type d -exec chmod 755 {} +
  run_root find "$release_dir" -type f -exec chmod 644 {} +
  if ! is_test_mode; then
    run_root chown -R "$owner" "$release_dir"
  fi

  if run_root test -e "$web_root"; then
    printf 'previous\n' | run_root tee "$state_file" >/dev/null
    run_root mv "$web_root" "$backup_dir"
  else
    printf 'initial\n' | run_root tee "$state_file" >/dev/null
  fi

  if ! run_root mv "$release_dir" "$web_root"; then
    if run_root test -e "$backup_dir"; then
      run_root mv "$backup_dir" "$web_root"
    fi
    run_root rm -f -- "$state_file"
    fail "切换 Web 目录失败，已尝试恢复旧版本"
  fi

  echo "prepared=$web_root"
  echo "rollback=$backup_dir"
}

commit_release() {
  [ "$#" -eq 2 ] || fail "commit 参数数量错误"
  local web_root="$1" release_id="$2"

  validate_web_root "$web_root"
  validate_release_id "$release_id"
  run_root test -s "$web_root/index.html" || fail "当前 Web 缺少 index.html，拒绝清理回滚目录"

  # 用户已确认：成功发布后不保留任何历史 Web 备份。
  remove_history "$web_root"
  echo "committed=$web_root"
}

rollback_release() {
  [ "$#" -eq 2 ] || fail "rollback 参数数量错误"
  local web_root="$1" release_id="$2"
  local backup_dir failed_dir state_file state

  validate_web_root "$web_root"
  validate_release_id "$release_id"
  backup_dir="${web_root}.previous.${release_id}"
  failed_dir="${web_root}.failed.${release_id}"
  state_file="${web_root}.state.${release_id}"

  if run_root test -e "$backup_dir"; then
    if run_root test -e "$web_root"; then
      run_root mv "$web_root" "$failed_dir"
    fi
    run_root mv "$backup_dir" "$web_root"
  elif run_root test -f "$state_file"; then
    state="$(run_root cat "$state_file")"
    if [ "$state" = "initial" ] && run_root test -e "$web_root"; then
      run_root mv "$web_root" "$failed_dir"
    fi
  fi

  run_root rm -rf -- "$failed_dir" "${web_root}.release.${release_id}" "$state_file"
  echo "rolled_back=$web_root"
}

MODE="${1:-}"
shift || true

case "$MODE" in
  prepare) prepare_release "$@" ;;
  commit) commit_release "$@" ;;
  rollback) rollback_release "$@" ;;
  *) fail "用法：$0 {prepare|commit|rollback} ..." ;;
esac
