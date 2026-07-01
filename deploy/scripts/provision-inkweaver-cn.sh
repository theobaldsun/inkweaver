#!/bin/bash
# 在 ECS 上一键初始化 InkWeaver 生产环境（Ubuntu 22.04）
# 用法：sudo bash deploy/scripts/provision-inkweaver-cn.sh
#
# 可选环境变量（执行前 export）：
#   DOMAIN=app.example.com
#   GIT_REPO=https://github.com/your-org/inkweaver.git
#   SMTP_USER / SMTP_PASS（勿写入 Git；可参考 deploy/INSTANCE.local.md）

set -euo pipefail

DOMAIN="${DOMAIN:-app.example.com}"
STORAGE_DOMAIN="storage.${DOMAIN}"
GIT_REPO="${GIT_REPO:-https://github.com/theobaldsun/inkweaver.git}"
REPO_DIR="${REPO_DIR:-/opt/inkweaver/repo}"
WEB_ROOT="/opt/inkweaver/web"
UPLOADS="/opt/inkweaver/uploads"
BACKUPS="/opt/inkweaver/backups"

echo "==> InkWeaver 生产初始化 domain=$DOMAIN"

# --- 1. 系统依赖 ---
if ! command -v docker &>/dev/null; then
  bash "$(dirname "$0")/ecs-init.sh"
fi

mkdir -p "$WEB_ROOT" "$UPLOADS" "$BACKUPS" "$(dirname "$REPO_DIR")"

# --- 2. 拉取代码 ---
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --ff-only
else
  git clone "$GIT_REPO" "$REPO_DIR"
fi
cd "$REPO_DIR"

# --- 3. 生成 .env.prod（若不存在）---
ENV_FILE="$REPO_DIR/.env.prod"
if [ ! -f "$ENV_FILE" ]; then
  PG_PASS="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  REDIS_PASS="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  MINIO_USER="inkweaver"
  MINIO_PASS="$(openssl rand -base64 20 | tr -dc 'a-zA-Z0-9' | head -c 20)"

  cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=${PG_PASS}
REDIS_PASSWORD=${REDIS_PASS}
UPLOADS_HOST_PATH=${UPLOADS}

NODE_ENV=production
PORT=3000
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=${PG_PASS}
DB_DATABASE=syncbox_db
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASS}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
APP_PUBLIC_URL=https://${DOMAIN}
CORS_ORIGIN=https://${DOMAIN},https://www.${DOMAIN}

MINIO_ROOT_USER=${MINIO_USER}
MINIO_ROOT_PASSWORD=${MINIO_PASS}

SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-CHANGE_ME_SMTP_AUTH_CODE}
SMTP_FROM=InkWeaver <${SMTP_USER:-noreply@${DOMAIN}}>
EOF
  chmod 600 "$ENV_FILE"
  echo "已生成 $ENV_FILE — 请确认 SMTP_PASS 后重新 up"
else
  echo "保留已有 $ENV_FILE"
fi

# --- 4. Docker 构建启动 ---
export UPLOADS_HOST_PATH="$UPLOADS"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

echo "==> 等待 API 就绪..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/readyz >/dev/null 2>&1; then
    curl -s http://127.0.0.1:3000/readyz
    break
  fi
  sleep 3
done

# --- 5. Nginx ---
NGINX_SRC="$REPO_DIR/deploy/nginx/inkweaver.cn.conf"
NGINX_DST="/etc/nginx/sites-available/inkweaver"
cp "$NGINX_SRC" "$NGINX_DST"
ln -sf "$NGINX_DST" /etc/nginx/sites-enabled/inkweaver
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx

echo ""
echo "========== 下一步（手动）=========="
echo "1. DNS A 记录：${DOMAIN}、www.${DOMAIN}、storage.${DOMAIN}、s3.${DOMAIN} -> 本机公网 IP"
echo "2. HTTPS: certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} -d storage.${DOMAIN} -d s3.${DOMAIN}"
echo "3. 上传 Web 静态到 ${WEB_ROOT}（本地 deploy/scripts/deploy-web.sh root@ECS_IP）"
echo "4. MinIO 控制台: https://storage.${DOMAIN}  账号 MINIO_ROOT_* 见 .env.prod"
echo "5. S3 客户端: Endpoint https://s3.${DOMAIN}  Bucket inkweaver"
if grep -q 'CHANGE_ME_SMTP' "$ENV_FILE" 2>/dev/null; then
  echo "6. 编辑 $ENV_FILE 填入 SMTP_PASS 后: docker compose -f docker-compose.prod.yml --env-file $ENV_FILE up -d server"
fi
