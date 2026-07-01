# InkWeaver Server 生产镜像（pnpm deploy 打包依赖）
# 构建上下文：仓库根目录

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

RUN pnpm install --frozen-lockfile --filter @inkweaver/server...
RUN pnpm --filter @inkweaver/shared build \
  && pnpm --filter @inkweaver/server build
RUN pnpm deploy --filter=@inkweaver/server --prod /deploy --legacy

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 inkweaver && adduser -u 1001 -G inkweaver -D inkweaver

COPY --from=builder /deploy ./
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/server/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh \
  && mkdir -p /app/uploads \
  && chown -R inkweaver:inkweaver /app

USER inkweaver
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
