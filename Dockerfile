# ─── 构建阶段 ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package 文件以利用 Docker 缓存层
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并构建前端
COPY . .
RUN npm run build

# ─── 生产运行阶段 ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

# 安装 better-sqlite3 编译依赖（构建后清理）
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 只复制 server 依赖（package.json + lock）
COPY server/package.json ./
RUN npm install --production && \
    npm rebuild better-sqlite3 --build-from-source && \
    npm cache clean --force

# 复制服务端代码
COPY server/ ./server/

# 复制 Cloudflare Functions 代码（被 server 动态导入）
COPY functions/ ./functions/

# 复制共享代码
COPY shared/ ./shared/

# 复制构建好的前端
COPY --from=builder /app/dist ./dist/

# 复制 _redirects（SPA 路由，可选）
RUN test -f _redirects && cp _redirects dist/_redirects || true

# 创建数据目录
RUN mkdir -p /app/data

# 环境变量默认值
ENV PORT=3000
ENV NODE_ENV=production
ENV KV_FILE=/app/data/kv-store.db
ENV D1_FILE=/app/data/d1-store.db

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth/status || exit 1

# 启动命令
CMD ["node", "server/index.js"]
