#!/bin/bash
# 安装 Nginx 站点并申请 Let's Encrypt 证书（在 ECS 上执行）
# 用法：sudo bash deploy/scripts/setup-nginx-ssl.sh app.yourdomain.com
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "用法: sudo $0 app.yourdomain.com"
  exit 1
fi

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CONF="/etc/nginx/sites-available/inkweaver"

sed "s/app.yourdomain.com/$DOMAIN/g" "$REPO/deploy/nginx/inkweaver.conf" > /tmp/inkweaver.conf
cp /tmp/inkweaver.conf "$CONF"
ln -sf "$CONF" /etc/nginx/sites-enabled/inkweaver
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl reload nginx

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || {
  echo "Certbot 需交互或有效邮箱，可手动执行："
  echo "  sudo certbot --nginx -d $DOMAIN"
}

echo "==> 请确认 .env.prod 中 APP_PUBLIC_URL=https://$DOMAIN 与 CORS_ORIGIN 一致"
