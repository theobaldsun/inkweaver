#!/bin/bash
# 每日备份：PostgreSQL + uploads（由 cron 调用）
# 示例 cron（每日 3:00）：
#   0 3 * * * /opt/inkweaver/repo/deploy/scripts/backup.sh >> /var/log/inkweaver-backup.log 2>&1
set -euo pipefail

REPO="${INKWEAVER_REPO:-/opt/inkweaver/repo}"
BACKUP_DIR="${INKWEAVER_BACKUP_DIR:-/opt/inkweaver/backups}"
UPLOADS_DIR="${INKWEAVER_UPLOADS:-/opt/inkweaver/uploads}"
RETENTION_DAYS=7

STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

cd "$REPO"

echo "[$STAMP] PG dump..."
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U postgres syncbox_db | gzip > "$BACKUP_DIR/pg_${STAMP}.sql.gz"

echo "[$STAMP] uploads tar..."
tar -czf "$BACKUP_DIR/uploads_${STAMP}.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" 2>/dev/null || true

echo "[$STAMP] 清理 ${RETENTION_DAYS} 天前的备份"
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[$STAMP] 完成"
