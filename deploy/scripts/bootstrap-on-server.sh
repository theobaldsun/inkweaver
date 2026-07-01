#!/bin/bash
# 在服务器上以 root 执行（Workbench 或 ssh -i SSH1.pem root@IP）
# 注意：与 provision-inkweaver-cn.sh 功能重叠，新环境优先使用 provision-inkweaver-cn.sh
set -euo pipefail

DOMAIN="${DOMAIN:-app.example.com}"
REPO_DIR="${REPO_DIR:-/opt/inkweaver/repo}"
GIT_REPO="${GIT_REPO:-https://github.com/theobaldsun/inkweaver.git}"
WEB_ROOT="/opt/inkweaver/web"
UPLOADS="/opt/inkweaver/uploads"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg ufw nginx certbot python3-certbot-nginx rsync

if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow OpenSSH 2>/dev/null || true
ufw allow 'Nginx Full' 2>/dev/null || true
ufw --force enable 2>/dev/null || true

mkdir -p "$WEB_ROOT" "$UPLOADS" /opt/inkweaver/backups "$(dirname "$REPO_DIR")"

if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" reset --hard origin/master 2>/dev/null || git -C "$REPO_DIR" reset --hard origin/main
else
  git clone "$GIT_REPO" "$REPO_DIR"
fi
cd "$REPO_DIR"

ENV_FILE="$REPO_DIR/.env.prod"
if [ ! -f "$ENV_FILE" ]; then
  PG_PASS="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  REDIS_PASS="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)"
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
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=7d
APP_PUBLIC_URL=https://${DOMAIN}
CORS_ORIGIN=https://${DOMAIN},https://www.${DOMAIN}
MINIO_ROOT_USER=inkweaver
MINIO_ROOT_PASSWORD=$(openssl rand -base64 20 | tr -dc 'a-zA-Z0-9' | head -c 20)
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
SMTP_FROM=InkWeaver <${SMTP_USER:-noreply@${DOMAIN}}>
EOF
  chmod 600 "$ENV_FILE"
fi

if [ -n "${SMTP_PASS:-}" ]; then
  sed -i "s|^SMTP_PASS=.*|SMTP_PASS=${SMTP_PASS}|" "$ENV_FILE"
fi

export UPLOADS_HOST_PATH="$UPLOADS"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

for i in $(seq 1 40); do
  curl -sf http://127.0.0.1:3000/readyz && break
  sleep 5
done

cp "$REPO_DIR/deploy/nginx/inkweaver.cn.conf" /etc/nginx/sites-available/inkweaver
ln -sf /etc/nginx/sites-available/inkweaver /etc/nginx/sites-enabled/inkweaver
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx

echo "Done. MinIO/SMTP secrets in $ENV_FILE"
