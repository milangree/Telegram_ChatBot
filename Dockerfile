# ─── 构建阶段 ────────────────────────────────────────────────────────
# 使用 --platform=$BUILDPLATFORM 在宿主原生架构完成前端静态打包，
# 规避 QEMU 跨架构仿真执行 Node.js JIT / esbuild 导致的 SIGILL (exit code 132) 非法指令崩溃，
# 且大幅提升前端构建性能（静态产物与 CPU 架构无关）。
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

# 先复制 package 文件以利用 Docker 缓存层
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并构建前端静态资产
COPY . .
RUN npm run build

# ─── 生产运行阶段 ─────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# 安装编译依赖 + 安装 server 生产依赖（优先使用 prebuild，支持 g++ 源码编译兜底）
COPY server/package.json server/package-lock.json ./
RUN apk add --no-cache python3 make g++ libstdc++ && \
    npm_config_python=/usr/bin/python3 npm ci --omit=dev && \
    npm cache clean --force && \
    apk del python3 make g++

# 复制服务端代码
COPY server/ ./server/

# 复制运维脚本（管理员恢复 CLI）
COPY scripts/ ./scripts/

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
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# 启动命令
CMD ["node", "server/index.js"]
