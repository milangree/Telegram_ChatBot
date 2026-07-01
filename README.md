<h1 align="center">🤖 Telegram ChatBot</h1>

<p align="center">
  Telegram 双向消息机器人 · Web 管理后台 · 多存储后端
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat&logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Vuetify-3-7B61FF?style=flat&logo=vuetify&logoColor=white" alt="Vuetify 3">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-4169e1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="MIT License">
</p>

<p align="center">
  <a href="./README_EN.md">English</a>
</p>

---

基于 **Cloudflare Pages + Pages Functions + Vue 3 (Vuetify 3)** 的 Telegram 双向聊天机器人。支持 **Cloudflare Pages** 和 **Docker** 两种部署方式，存储层支持 **KV / D1 / Hyperdrive（PostgreSQL & MySQL）** 自由切换。

用户私聊 Bot → 自动在管理员话题群组创建话题 → 管理员回复 → 实时转发回用户。

---

## ✨ 功能

**消息** — 双向转发 · 独立话题管理 · 编辑同步 · 消息去重 · 关键词过滤

**验证** — 数学题按钮 · 4 位数字图片验证码 · 5 位字母数字图片验证码 · 白名单跳过

**风控** — 频率限制 · 封禁 / 解封 / 永久封禁 · 申诉流程 · 命令过滤

**后台** — 仪表盘 · 对话记录 · 用户管理 · 白名单 · 设置 · 个人中心 · 2FA

**存储** — KV ↔ D1 ↔ Hyperdrive 三向同步切换 · SQL 导入导出（明文 / Base64 / AES-256-GCM）

**多语言** — 简体中文 · 繁體中文 · English

---

## 🚀 Cloudflare Pages 部署

### 1. 创建存储资源

**必需 — KV 命名空间：** Cloudflare Dashboard → Workers & Pages → KV → Create a namespace

**可选 — D1 数据库：** `npx wrangler d1 create tg-chatbot-d1`

**可选 — Hyperdrive：** Dashboard → Hyperdrive → 创建连接（支持 `postgres://` / `mysql://`）

### 2. 创建 Pages 项目

Fork 本仓库 → Workers & Pages → Create → Pages → 连接 GitHub 仓库

| 配置项 | 值 |
| :---: | :---: |
| 框架预设 | `Vue` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |

### 3. 添加绑定

Settings → Bindings → Add binding：

| 变量名 | 绑定类型 | 必需 |
| :---: | :---: | :---: |
| `KV` | KV namespace | ✅ |
| `D1` | D1 database | ❌ |
| `HYPERDRIVE` | Hyperdrive | ❌ |

> 使用 Hyperdrive 需额外执行 `npm install pg mysql2` 并在 Settings → Compatibility flags 添加 `nodejs_compat`。

### 4. 重新部署

部署成功后得到 `https://your-project.pages.dev`。

---

## 🐳 Docker 部署

Docker 部署使用与 Cloudflare Pages 完全相同的业务代码，存储通过本地 SQLite 实现。

### 快速启动

```bash
docker pull kakuwari/tg-chatbot:latest

# 或使用 docker compose
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
docker compose up -d
```

访问 `http://localhost:3000` 进入 WebUI。

### 环境变量

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `3000` | 服务端口 |
| `KV_FILE` | `./data/kv-store.db` | KV 存储路径 |
| `D1_FILE` | `./data/d1-store.db` | D1 存储路径 |
| `DATABASE_URL` | — | PostgreSQL / MySQL 连接串 |
| `ACTIVE_DB` | `kv` | 存储后端：`kv` / `d1` / `hyperdrive` |

### 使用 PostgreSQL

编辑 `docker-compose.yml`，取消 PostgreSQL 服务注释，设置 `DATABASE_URL` 和 `ACTIVE_DB=hyperdrive`。

### 本地构建

```bash
docker build -t telegram-chatbot .
docker run -d -p 3000:3000 -v data:/app/data telegram-chatbot
```

### 自动发布到 Docker Hub

配置 GitHub Secrets（`DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`），推送 tag 自动构建：

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## 🔐 首次访问

默认管理员：`admin` / `admins`

首次登录后请立即修改密码并开启 2FA。注册第一个账号后默认管理员自动禁用。

---

## 🧭 配置顺序

1. 登录 WebUI → 修改密码 → 开启 2FA
2. 设置 **Bot Token**（@BotFather 获取）
3. 设置**话题群组 ID**（超级群组，系统提供查询辅助）
4. 设置**管理员 Telegram ID**
5. 设置 **Webhook URL**：`https://你的域名/webhook`
6. 调整验证、风控、消息过滤等开关
7. 测试：用户发消息 → 话题创建 → 管理员回复 → 用户收到

---

## ⚙️ 配置说明

### Bot

| 配置项 | 说明 |
| :--- | :--- |
| `BOT_TOKEN` | Telegram Bot Token |
| `FORUM_GROUP_ID` | 话题超级群组 ID |
| `ADMIN_IDS` | 管理员 Telegram ID（逗号分隔） |

### 验证

| 配置项 | 说明 |
| :--- | :--- |
| `VERIFICATION_ENABLED` | 验证开关 |
| `CAPTCHA_TYPE` | `math` / `image_numeric` / `image_alphanumeric` |
| `VERIFICATION_TIMEOUT` | 超时秒数 |
| `MAX_VERIFICATION_ATTEMPTS` | 最大尝试次数 |

### 风控

| 配置项 | 说明 |
| :--- | :--- |
| `WHITELIST_ENABLED` | 白名单开关 |
| `MAX_MESSAGES_PER_MINUTE` | 每分钟最大消息数 |
| `AUTO_UNBLOCK_ENABLED` | 申诉开关 |
| `BOT_COMMAND_FILTER` | 命令过滤 |
| `ADMIN_NOTIFY_ENABLED` | 管理员私聊通知 |
| `ZALGO_FILTER_ENABLED` | Zalgo 文字过滤 |
| `MESSAGE_FILTER_RULES` | 关键词过滤规则 |
| `BOT_LOCALE` | 机器人语言（`zh-hans` / `zh-hant` / `en`） |

---

## 🗄️ 存储说明

| 后端 | 适用场景 | 复杂度 |
| :--- | :--- | :---: |
| KV | 小中型，开箱即用 | ⭐ |
| D1 | 中大型，SQL 查询 | ⭐⭐ |
| Hyperdrive | 大型生产，外部数据库 | ⭐⭐⭐ |

在 WebUI 设置页可一键切换，系统自动同步数据。支持 SQL 导出（明文 / Base64 / AES-256-GCM 加密）。

---

## 🛠️ 本地开发

```bash
npm install
npm run build
npm run preview
```

> 完整后端能力依赖 Cloudflare 环境，本地适合前端预览和构建验证。

---

## 🩺 常见问题

**WebUI 500 / 白屏** — 检查 KV 是否绑定且变量名为大写 `KV`，绑定后需重新部署

**Webhook 设置失败** — Bot Token 是否正确，URL 必须是公网 HTTPS：`https://域名/webhook`

**消息不出现** — 群组是否开启话题功能，Bot 是否有管理权限，`FORUM_GROUP_ID` 是否正确（`-100` 开头）

**忘记密码** — 已启用 2FA 可通过登录页找回；未启用需手动修改存储

**Docker 无 HTTPS** — 使用 Cloudflare Tunnel 或 Nginx 反向代理

---

## 🛡️ 安全

- Webhook 使用 Secret Token 校验来源
- 密码 `salt:sha256` 哈希存储
- 支持 TOTP 两步验证
- 默认管理员注册后自动禁用
- SQL 导出支持 AES-256-GCM 加密
- 所有查询参数化绑定，防 SQL 注入

---

## 📄 License

以仓库根目录 `LICENSE` 文件为准。
