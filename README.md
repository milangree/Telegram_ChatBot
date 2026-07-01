<h1 align="center">🤖 Telegram ChatBot</h1>

<p align="center">
  ☁️ 面向 Cloudflare Pages 的 Telegram 双向消息机器人与 Web 管理后台
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat&logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Vite-Build-646cff?style=flat&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/Storage-KV%20%2F%20D1%20%2F%20Hyperdrive-2f6feb?style=flat" alt="KV / D1 / Hyperdrive">
  <img src="https://img.shields.io/badge/Auth-2FA%20%2F%20Session-8a63d2?style=flat" alt="2FA / Session">
  <img src="https://img.shields.io/badge/DB-PostgreSQL%20%2F%20MySQL-4169e1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL / MySQL">
</p>

> 一个基于 **Cloudflare Pages + Pages Functions + Vue 3** 的 Telegram 双向聊天机器人项目，支持话题群组转发、人机验证、多语言、2FA 登录、Webhook 管理与可视化后台配置。存储层支持 **KV / D1 / Hyperdrive（PostgreSQL & MySQL）** 三种后端自由切换。

用户向 Bot 私聊发送消息后，机器人会自动在管理员话题群组（超级群组）中创建对应话题；管理员在话题中的回复会被实时转发回用户，实现完整的双向沟通链路。

---

## 目录

- [项目特色](#项目特色)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [Cloudflare Pages 部署](#cloudflare-pages-部署)
- [首次访问与初始化](#首次访问与初始化)
- [使用指南](#使用指南)
- [配置说明](#配置说明)
- [数据存储说明](#数据存储说明)
- [WebUI 页面说明](#webui-页面说明)
- [国际化说明](#国际化说明)
- [本地开发与预览](#本地开发与预览)
- [Docker 部署](#docker-部署)
- [故障排除](#故障排除)
- [安全说明](#安全说明)
- [更新项目](#更新项目)
- [License](#license)
- [致谢](#致谢)

---

## ✨ 项目特色

| 模块 | 描述 |
| :--- | :--- |
| 双向消息转发 | 用户私聊 Bot 后，消息自动进入管理员话题群组，管理员回复再实时转发回用户。 |
| 独立话题管理 | 每位用户映射独立话题，便于区分不同用户及追溯消息上下文。 |
| 编辑同步与去重 | 管理员编辑群组话题消息时可同步到用户侧；内置消息去重机制。 |
| 人机验证系统 | 支持数学题按钮验证、4 位数字图片验证码、5 位字母数字图片验证码。 |
| 风控能力 | 支持频率限制、白名单、封禁 / 解封 / 永久封禁、申诉流程等。 |
| 管理后台 | 提供仪表盘、对话记录、用户管理、白名单、设置、个人中心等页面。 |
| 认证能力 | 支持首次初始化管理员、用户名密码登录、2FA、密码找回、会话管理。 |
| Webhook 管理 | 支持 Webhook URL 设置、Webhook Secret 管理、Bot Commands 刷新。 |
| 存储切换 | 支持 KV、D1、Hyperdrive（PostgreSQL / MySQL）之间同步后自由切换，并支持 SQL 导入导出。 |
| 多语言 | 支持简体中文、繁體中文、English。 |

### 核心消息流程

```mermaid
flowchart TD
  A[用户私聊 Bot 发送消息] --> B[Bot 转发到管理员话题]
  B --> C{转发成功?}
  C -- 是 --> D[对用户原消息添加 ✅ 表情回应]
  C -- 否 --> E[返回发送失败提示]

  F[管理员在话题发送消息] --> G[Bot 转发给对应用户]
  G --> H{转发成功?}
  H -- 是 --> I[对管理员原消息添加 ✅ 表情回应]
  H -- 否 --> J[记录失败并保持原逻辑]

  K[收到 edited_message] --> L{是否群话题消息?}
  L -- 否 --> M[不处理]
  L -- 是 --> N{是否管理员?}
  N -- 否 --> O[不处理（用户编辑不同步）]
  N -- 是 --> P[按映射同步编辑到用户]
```

> 说明：
> - "✅ 表情回应"只在消息成功转发后触发，用于给发送方即时反馈。
> - 编辑同步只允许管理员在群话题内触发；用户侧编辑不会同步到管理员端。

### 风控与验证能力

- 数学题按钮验证
- 图片验证码（4 位数字 / 5 位字母数字）
- 每分钟最大消息数限制
- 白名单跳过验证
- 用户封禁 / 解封 / 永久封禁
- 机器人命令过滤
- 用户申诉支持

### WebUI 管理能力

- 仪表盘统计信息
- 对话记录查看与删除
- 用户搜索与详情查看
- 白名单维护
- Bot Token / Webhook / 群组 / 管理员设置
- 个人中心密码与 2FA 管理
- 亮色 / 暗色主题
- 液态玻璃效果开关
- SQL 导入导出与数据清理
- **存储后端切换（KV ↔ D1 ↔ Hyperdrive）**

---

## 🧱 项目结构

<details>
<summary>点击展开查看完整项目结构</summary>

```text
.
├── functions/
│   ├── webhook.js                    # Telegram Webhook 入口
│   ├── api/
│   │   └── [[path]].js               # WebUI REST API
│   └── _shared/
│       ├── auth.js                   # 鉴权、会话、密码处理
│       ├── bot.js                    # Bot 核心逻辑
│       ├── bot-i18n.js               # Bot 端 i18n 封装
│       ├── captcha.js                # 图片验证码生成
│       ├── db.js                     # 数据库统一抽象（KV / D1 / Hyperdrive）
│       ├── db-kv.js                  # KV 存储实现（含缓存优化）
│       ├── db-d1.js                  # D1（SQLite）存储实现
│       ├── db-hyperdrive.js          # Hyperdrive 存储实现（PostgreSQL / MySQL）
│       ├── db-routing.js             # 存储路由与三向同步
│       ├── db-settings.js            # 默认设置项
│       ├── db-sql.js                 # SQL 导入导出
│       ├── tg.js                     # Telegram Bot API 封装
│       └── totp.js                   # TOTP 两步验证实现
├── shared/
│   ├── display-name.js
│   ├── i18n.js                       # 共享 i18n 工具
│   ├── message-filters.js            # 消息过滤器规则引擎
│   └── locales/                      # 共享语言资源
├── src/
│   ├── components/                   # 前端通用组件
│   ├── locales/                      # 前端语言资源
│   ├── router/                       # Vue Router
│   ├── stores/                       # Pinia 状态管理
│   ├── views/                        # 页面视图
│   ├── App.vue                       # 前端根组件
│   └── main.js                       # 入口
├── _redirects                        # Cloudflare Pages 路由重写
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

</details>

### 关键模块说明

| 模块 | 文件 | 职责 |
| :--- | :--- | :--- |
| Webhook 入口 | `functions/webhook.js` | 接收 Telegram webhook 推送，校验 Secret Token，分发更新到 Bot 处理逻辑 |
| REST API | `functions/api/[[path]].js` | WebUI 后端 API，鉴权、设置管理、用户/对话 CRUD、存储切换 |
| Bot 核心 | `functions/_shared/bot.js` | 消息处理、验证、话题映射、管理员面板、命令处理 |
| 存储抽象 | `functions/_shared/db.js` | 统一 `DB` 门面类，自动路由到当前活跃存储（KV / D1 / Hyperdrive） |
| KV 存储 | `functions/_shared/db-kv.js` | Cloudflare KV 实现，含内存缓存、列表缓存、负缓存等优化 |
| D1 存储 | `functions/_shared/db-d1.js` | Cloudflare D1（SQLite）实现，完整 SQL 查询支持 |
| Hyperdrive 存储 | `functions/_shared/db-hyperdrive.js` | PostgreSQL / MySQL 实现，自动建表、连接池复用、参数化查询 |
| 存储路由 | `functions/_shared/db-routing.js` | 活跃存储检测、三向数据同步、Schema 初始化与修复 |
| SQL 导入导出 | `functions/_shared/db-sql.js` | 支持明文 / Base64 / AES-256-GCM 三种模式的业务数据 SQL 导入导出 |

---

## 🚀 快速开始

### 环境要求

- Cloudflare Pages 账号
- Cloudflare KV（必需）
- Cloudflare D1 或 Hyperdrive（可选，用于 SQL 存储）
- Telegram Bot Token（通过 [@BotFather](https://t.me/BotFather) 创建）

### 部署方式

推荐使用 **GitHub 仓库 → Cloudflare Pages 自动部署**。

---

## ☁️ Cloudflare Pages 部署

### 步骤 1：Fork 或导入仓库

将本仓库 Fork 到你自己的 GitHub 账号，或直接克隆后推送到你自己的仓库。

### 步骤 2：准备存储资源

#### 必需：创建 KV 命名空间

登录 Cloudflare Dashboard：

1. 进入 **Workers & Pages → KV**
2. 点击 **Create a namespace**
3. 名称建议：`tg-chatbot-kv`

#### 可选：创建 D1 数据库

```bash
# 使用 wrangler CLI 或直接在 Cloudflare Dashboard 操作
npx wrangler d1 create tg-chatbot-d1
```

#### 可选：创建 Hyperdrive 数据库

Hyperdrive 支持连接外部 **PostgreSQL** 或 **MySQL** 数据库：

1. 在 Cloudflare Dashboard → **Hyperdrive** 中创建数据库连接
2. 提供你的数据库连接字符串（支持 `postgres://` / `mysql://`）
3. 绑定后变量名必须为 `HYPERDRIVE`
4. 需要安装额外依赖并启用 `nodejs_compat` 兼容性标志（见下方说明）

### 步骤 3：创建 Cloudflare Pages 项目

1. 打开 **Workers & Pages** → **Create** → **Pages**
2. 连接 GitHub 仓库，选择本项目
3. 填写构建参数：

| 配置项 | 值 |
| :---: | :---: |
| 框架预设 | `Vue` |
| 构建命令 | `npm run build` |
| 构建输出目录 | `dist` |

4. 开始部署（首次部署可能会因尚未绑定 KV 而失败，属于正常现象）

### 步骤 4：添加绑定

#### 绑定 KV（必需）

**Settings → Bindings → Add binding**

| 字段 | 值 |
| :---: | :---: |
| 变量名 | `KV` |
| 命名空间 | 你创建的 KV 命名空间 |

> `KV` 变量名必须完全一致。

#### 绑定 D1（可选）

| 字段 | 值 |
| :---: | :---: |
| 变量名 | `D1` |
| 数据库 | 你的 D1 数据库 |

#### 绑定 Hyperdrive（可选）

| 字段 | 值 |
| :---: | :---: |
| 变量名 | `HYPERDRIVE` |
| Hyperdrive | 你创建的 Hyperdrive 连接 |

> **使用 Hyperdrive 前需要额外配置：**
> 1. 安装数据库驱动依赖：
>    ```bash
>    npm install pg mysql2
>    ```
> 2. 在 Cloudflare Pages 项目设置中启用 `nodejs_compat` 兼容性标志：
>    - **Settings → Compatibility flags**
>    - 添加 `nodejs_compat`
> 3. 连接字符串支持 `postgres://` 或 `mysql://` 开头，Hyperdrive 会自动检测数据库类型

### 步骤 5：重新部署

完成绑定后，重新部署 Pages 项目。成功后你会得到：

```text
https://your-project.pages.dev
```

---

## 🔐 首次访问与初始化

### 默认管理员账号

项目在首次部署后会自动创建默认管理员：

- **用户名：** `admin`
- **密码：** `admins`

首次登录后请**立即修改密码**并建议开启 2FA。

### 登录 WebUI

打开你的 Pages 域名，进入登录页后：

- 首次访问会自动进入注册页面
- 注册第一个账号后，默认管理员自动禁用
- 支持用户名密码登录或 2FA 登录
- 如忘记密码且已启用 2FA，可在登录页找回

---

## 🧭 使用指南

### 首次建议配置顺序

1. 登录 WebUI，修改默认密码
2. 开启 2FA（推荐）
3. 在设置页配置 **Bot Token**（从 @BotFather 获取）
4. 配置**话题群组 ID（超级群组）** — 系统提供群组查询辅助功能
5. 配置**管理员 Telegram ID**
6. 设置 **Webhook URL**：`https://你的域名/webhook`
7. 调整安全与功能开关（验证类型、白名单、频率限制等）
8. 测试：用户发消息 → 群组创建话题 → 管理员回复 → 用户收到消息

### 系统工作流程

#### 用户消息流程

1. 用户向 Bot 私聊发送消息
2. Bot 按序检查：是否封禁 → 是否需要验证 → 是否超频 → 消息过滤器
3. 通过检查后，消息转发到管理员话题群组
4. 若该用户没有对应话题，则自动创建新话题并置顶用户卡片
5. 管理员在话题内回复 → 回复被转发回用户
6. 消息记录写入当前激活的存储后端

#### 管理员消息流程

1. 管理员在话题群组的对应话题内发送消息
2. 系统根据 thread_id 映射定位对应用户
3. 消息转发给对应用户，并添加 ✅ 表情回应
4. 管理员编辑消息时，在允许时间窗口内同步更新到用户侧

### Telegram Bot 所需权限

确保 Bot 在话题超级群组中拥有以下权限：

- 发送消息、读取消息
- 创建 / 管理话题
- 删除消息、置顶消息
- 目标群组必须 **开启话题功能**

---

## ⚙️ 配置说明

### Bot 配置

| 配置项 | 说明 |
| :--- | :--- |
| `BOT_TOKEN` | Telegram Bot Token |
| `FORUM_GROUP_ID` | 管理员话题超级群组 ID |
| `ADMIN_IDS` | 允许管理 Bot 的 Telegram 用户 ID（逗号分隔） |

### Webhook

| 配置项 | 说明 |
| :--- | :--- |
| `WEBHOOK_URL` | Telegram 推送地址 |
| `WEBHOOK_SECRET` | 请求校验密钥（自动生成） |

### 人机验证

| 配置项 | 说明 |
| :--- | :--- |
| `VERIFICATION_ENABLED` | 启用 / 关闭验证 |
| `CAPTCHA_TYPE` | `math` / `image_numeric` / `image_alphanumeric` |
| `CAPTCHA_SITE_URL` | 验证码图片地址（自动设置） |
| `VERIFICATION_TIMEOUT` | 超时时间（秒） |
| `MAX_VERIFICATION_ATTEMPTS` | 最大尝试次数 |

### 风控与功能

| 配置项 | 说明 |
| :--- | :--- |
| `WHITELIST_ENABLED` | 白名单功能开关 |
| `MAX_MESSAGES_PER_MINUTE` | 每分钟最大消息数 |
| `BOT_COMMAND_FILTER` | 过滤未知命令 |
| `AUTO_UNBLOCK_ENABLED` | 用户申诉开关 |
| `ADMIN_NOTIFY_ENABLED` | 管理员私聊消息通知 |
| `INLINE_KB_MSG_DELETE_ENABLED` | 带按钮消息自动撤回 |
| `INLINE_KB_MSG_DELETE_SECONDS` | 撤回延迟秒数 |
| `WELCOME_ENABLED` / `WELCOME_MESSAGE` | 欢迎消息 |
| `MESSAGE_FILTER_RULES` | 消息过滤器规则 |
| `ZALGO_FILTER_ENABLED` | ZALGO 字符过滤 |
| `BOT_LOCALE` | 机器人语言（zh-hans / zh-hant / en） |

### 数据存储

| 配置项 | 说明 |
| :--- | :--- |
| `ACTIVE_DB` | 当前存储后端：`kv` / `d1` / `hyperdrive` |
| 存储切换 | 在设置页选择目标，系统自动执行同步后切换 |
| SQL 导出 | 支持明文 / Base64 / AES-256-GCM 加密三种模式 |
| SQL 导入 | 导入到当前活跃的存储后端，自动同步到其他后端 |

---

## 🗄️ 数据存储说明

项目支持 **三种后端存储**，可在 WebUI 设置页自由切换。

### 存储后端对比

| 特性 | KV | D1（SQLite） | Hyperdrive（PostgreSQL / MySQL） |
| :--- | :--- | :--- | :--- |
| 配置复杂度 | ⭐ 简单 | ⭐⭐ 中等 | ⭐⭐⭐ 需要外部数据库 |
| 查询能力 | 仅 Key-Value | SQL 完整查询 | SQL 完整查询 + JOIN |
| 扩展性 | 小中型 | 中大型 | 大型生产环境 |
| 数据持久性 | 高 | 高 | 最高（自有数据库） |
| 免费额度 | 有 | 有 | 取决于数据库供应商 |
| KV 读取优化 | ✅ 内存缓存、列表缓存 | N/A | N/A |

### KV 缓存优化说明

当使用 KV 作为存储后端时，系统内置了多层缓存优化以减少 KV 读取次数：

- **内存缓存**：默认 30 秒 TTL，settings 60 秒 TTL
- **负缓存**：空值缓存 5 秒，避免反复读取不存在的键
- **列表缓存**：`kvListAll()` 结果缓存 3 秒，减少 KV list 操作
- **全量设置缓存**：`getAllSettings()` 整体缓存，避免每次遍历 27 个 key
- **缓存自动失效**：写操作自动使相关前缀缓存失效
- **缓存 GC**：超过 5000 条目时自动清理过期项

### 存储切换

系统支持 **KV ↔ D1 ↔ Hyperdrive 三向同步后切换**：

1. 在 WebUI 设置页选择目标存储
2. 系统自动将当前数据全量同步到目标存储
3. 切换后所有读写操作指向新存储
4. 原有存储数据保留，可作为备份随时切回

### SQL 导出 / 导入

- 支持三种导出模式：**明文** / **Base64** / **AES-256-GCM 加密**
- 导出的 SQL 文件包含完整的业务数据（不含 WebUI 账号信息）
- 导入时自动同步到所有绑定的存储后端

---

## 🖥️ WebUI 页面说明

### 仪表盘

展示系统整体状态：用户数、封禁数、消息数量、今日消息、最近对话、配置状态。

### 对话记录

- 用户历史消息查看
- 实时增量加载（delta mode）
- 用户搜索与详情跳转
- 删除会话（自动关闭对应话题、重置验证状态）

### 用户管理

- 用户列表分页展示
- 支持按正常 / 封禁 / 全部筛选
- 用户详情查看（含封禁原因、白名单状态、验证状态）
- 快捷操作：封禁 / 解封 / 永久封禁 / 加白名单 / 查看消息历史

### 白名单

- 手动添加用户到白名单
- 查看添加原因与时间
- 移除白名单

### 系统设置

- Bot Token 设置与在线测试
- 管理员 ID 卡片式管理
- 话题群组 ID 配置与在线群组查询
- Webhook 管理（URL / Secret / 命令刷新）
- 验证、风控、消息过滤等全量配置
- **存储后端切换（KV / D1 / Hyperdrive）**
- SQL 导出 / 导入（明文 / Base64 / AES 加密）
- 数据清理（保留 WebUI 账号）
- 液态玻璃视觉效果开关

### 个人中心

- 修改用户名
- 修改密码
- 2FA 设置（启用 / 禁用 / 验证）
- TOTP 二维码展示

---

## 🌐 国际化说明

项目包含前后端共享语言资源，当前支持：

| 语言 | 区域代码 |
| :--- | :--- |
| 简体中文 | `zh-hans` |
| 繁體中文 | `zh-hant` |
| English | `en` |

文案文件位置：

```text
shared/locales/    # 前后端共享文案
src/locales/       # 前端界面文本
```

Bot 端语言通过 `BOT_LOCALE` 设置项配置，WebUI 语言跟随浏览器 `Accept-Language` 头自动切换。

---

## 🛠️ 本地开发与预览

> 本项目完整能力依赖 Cloudflare 环境（Pages Functions、KV、D1、Hyperdrive），本地适合做前端预览或构建验证。

```bash
# 安装依赖
npm install

# 如果使用 Hyperdrive，额外安装数据库驱动
npm install pg mysql2

# 构建前端
npm run build

# 预览构建结果
npm run preview

# 本地开发（仅前端，无后端 API）
npx vite
```

### Cloudflare 兼容性说明

使用 Hyperdrive 时需要在 Cloudflare Pages 项目设置中启用 `nodejs_compat` 兼容性标志，否则 `pg` / `mysql2` 模块无法正常运行。

---

## 🐳 Docker 部署

> 本项目同时支持 **Cloudflare Pages** 和 **Docker** 两种部署方式。Docker 部署使用与 Cloudflare Pages 完全相同的业务代码，存储层通过本地 SQLite 实现 KV 和 D1 绑定，同时保留 Hyperdrive（PostgreSQL / MySQL）支持。

### Docker Hub 镜像

```bash
# 直接拉取预构建镜像
docker pull kakuwari/tg-chatbot:latest
```

### 快速启动（docker compose）

```bash
# 克隆仓库
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot

# 启动服务（默认使用 KV 存储）
docker compose up -d

# 查看日志
docker compose logs -f
```

启动后访问 `http://localhost:3000` 即可进入 WebUI。

### 环境变量

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `3000` | 服务监听端口 |
| `KV_FILE` | `./data/kv-store.db` | KV 存储 SQLite 文件路径 |
| `D1_FILE` | `./data/d1-store.db` | D1 存储 SQLite 文件路径 |
| `DATABASE_URL` | — | PostgreSQL / MySQL 连接字符串（启用 Hyperdrive） |
| `ACTIVE_DB` | `kv` | 默认存储后端：`kv` / `d1` / `hyperdrive` |

### 使用 PostgreSQL 后端

编辑 `docker-compose.yml`，取消 PostgreSQL 服务的注释：

```yaml
services:
  telegram-chatbot:
    environment:
      - DATABASE_URL=postgresql://telegram:telegram_password@postgres:5432/telegram_bot
      - ACTIVE_DB=hyperdrive

  postgres:
    image: postgres:16-alpine
    container_name: telegram-chatbot-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: telegram_bot
      POSTGRES_USER: telegram
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-telegram_password}
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

然后在 WebUI 设置页中切换存储后端为 Hyperdrive。

### 本地构建镜像

```bash
# 构建镜像
docker build -t telegram-chatbot .

# 运行
docker run -d \
  --name telegram-chatbot \
  -p 3000:3000 \
  -v telegram-chatbot-data:/app/data \
  telegram-chatbot
```

### Webhook 配置

Docker 部署时，需要将 Webhook URL 设置为你的公网地址：

```
https://你的域名/webhook
```

如果你的服务器没有 HTTPS，可以使用 Cloudflare Tunnel 或 Nginx 反向代理。

### GitHub Actions 自动发布

项目配置了自动发布工作流，推送 tag 时自动构建并推送到 Docker Hub：

```bash
# 打 tag 触发自动构建
git tag v1.0.0
git push origin v1.0.0
```

需要在 GitHub 仓库设置中配置以下 Secrets：
- `DOCKERHUB_USERNAME` — Docker Hub 用户名
- `DOCKERHUB_TOKEN` — Docker Hub Access Token

---

## 🩺 故障排除

<details>
<summary>点击展开查看常见问题</summary>

### 1. WebUI 打开返回 500 或白屏

检查：
- 是否已绑定 `KV`（变量名必须为大写 `KV`）
- 是否完成了绑定后的重新部署

### 2. 设置 Webhook 失败

检查：
- Bot Token 是否正确
- Webhook URL 必须是公网 HTTPS 地址，格式：`https://你的域名/webhook`

### 3. 用户消息没有出现在话题群组

检查：
- 话题超级群组是否开启了 **话题功能**
- Bot 是否已加入该群组并拥有管理话题权限
- `FORUM_GROUP_ID` 是否正确（超级群组一般以 `-100` 开头）

### 4. 找不到用户头像

用户未与 Bot 交互过，或 Telegram 侧无法获取。系统会自动回退为首字母头像。

### 5. 忘记了 WebUI 密码

- 账号启用了 2FA → 通过登录页"找回密码"重置
- 未启用 2FA → 需要在存储中手动修改 web_users 表数据

### 6. 清空数据库会删除登录账号吗？

**不会。** 清空功能只清空业务数据（用户、消息、白名单等），WebUI 账号和 2FA 信息保留。

### 7. Hyperdrive 连接失败

检查：
- 是否安装了 `pg` 或 `mysql2` 依赖
- Cloudflare Pages 是否启用了 `nodejs_compat` 兼容性标志
- 连接字符串格式是否正确（`postgres://` 或 `mysql://`）
- 数据库是否允许 Cloudflare IP 地址访问

### 8. KV 读取额度消耗过快？

项目已内置多层缓存优化。如果仍有高消耗情况，请检查：
- 是否频繁调用 `getAllSettings()`（已缓存 60 秒）
- 验证码相关的 KV 操作属于正常高频场景

</details>

---

## 🛡️ 安全说明

- Webhook 使用 `X-Telegram-Bot-Api-Secret-Token` 校验来源
- WebUI 密码以 `salt:sha256` 哈希存储，不保存明文
- 登录会话使用随机 Token 管理，支持超时过期
- 支持 TOTP 两步验证（2FA）
- 默认管理员注册后自动禁用，防止被利用
- 存储切换和 SQL 导入导出保留 WebUI 账号安全隔离
- SQL 导出支持 AES-256-GCM 加密保护敏感数据
- 所有数据库查询均使用参数化绑定，防止 SQL 注入

---

## 🔄 更新项目

### 方式 1：同步上游仓库

将你的 Fork 仓库与上游同步后，Pages 自动重新部署。

### 方式 2：手动合并

```bash
git add .
git commit -m "你的修改说明"
git pull upstream main
# 解决冲突
git push origin main
```

Pages 检测到推送后会自动部署。

---

## 📄 License

本项目仓库内已包含 `LICENSE` 文件，请以仓库根目录中的授权文件为准。

---

## 🙌 致谢

感谢以下技术与平台支持：

- [Cloudflare Pages](https://pages.cloudflare.com/) / [Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/) / [D1](https://developers.cloudflare.com/d1/) / [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Vue 3](https://vuejs.org/) / [Vite](https://vitejs.dev/) / [Pinia](https://pinia.vuejs.org/) / [Vue Router](https://router.vuejs.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

<p align="center">
  ⭐ 如果这个项目对你有帮助，欢迎点一个 Star
</p>
