#!/bin/sh
# 启动前等待 PostgreSQL 并执行迁移（生产）
set -e

if [ "${SKIP_MIGRATIONS:-}" != "true" ]; then
  echo "[entrypoint] Running database migrations..."
  node dist/scripts/run-migrations.js || {
    echo "[entrypoint] Migration failed"
    exit 1
  }
fi

echo "[entrypoint] Starting Nest server..."
exec "$@"
