#!/bin/bash
# InkWeaver ECS 一次性初始化（Ubuntu 22.04）
# 用法：sudo bash deploy/scripts/ecs-init.sh

set -euo pipefail

echo "==> 系统更新"
apt-get update && apt-get upgrade -y

echo "==> 安装基础工具"
apt-get install -y ca-certificates curl gnupg ufw nginx certbot python3-certbot-nginx rsync

echo "==> 配置 2GB swap（2G 内存机器建议）"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 安装 Docker"
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

echo "==> 防火墙"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> 部署目录"
mkdir -p /opt/inkweaver/{web,uploads,backups,repo}
chown -R "$SUDO_USER:$SUDO_USER" /opt/inkweaver 2>/dev/null || true

echo "==> 完成。下一步："
echo "  1. 将代码同步到 /opt/inkweaver/repo"
echo "  2. cp deploy/env.prod.example .env.prod 并填写密码/SMTP/域名"
echo "  3. docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build"
echo "  4. 配置 deploy/nginx/inkweaver.conf 并 certbot"
