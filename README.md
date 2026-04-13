# Telegram 双向消息桥接机器人（Cloudflare Pages Functions）

基于 **Cloudflare Pages + Pages Functions + KV（可选 D1）** 的 Telegram 双向消息系统。  
该项目将“用户私聊 Bot”与“管理员话题群组”打通，并提供完整的 Web 管理后台，用于配置、审计与日常运维。

默认界面语言为 **简体中文（zh-hans）**，同时支持 **繁體中文（zh-hant）** 与 **English（en）**。

---

## 目录

- [项目定位](#项目定位)
- [功能概览](#功能概览)
- [多语言与 i18n](#多语言与-i18n)
- [部署说明（Cloudflare）](#部署说明cloudflare)
- [初始化配置](#初始化配置)
- [Bot 指令](#bot-指令)
- [项目结构](#项目结构)
- [数据与存储](#数据与存储)
- [安全设计](#安全设计)
- [常见问题](#常见问题)
- [License](#license)

---

## 项目定位

本项目用于构建一条稳定的双向沟通链路：

1. 用户向 Bot 私聊发送消息  
2. 系统按用户维度自动创建或复用话题群组中的对应话题并转发消息  
3. 管理员在对应话题内回复，消息自动回传至用户私聊  
4. 管理后台提供用户管理、白名单、封禁、验证、Webhook、存储切换等能力

核心组件：

- `functions/webhook.js`：Telegram Webhook 入口
- `functions/api/[[path]].js`：Web 管理后台 API
- `src/`：Vue 3 管理后台前端
- `shared/i18n.js`：前后端共享国际化词典

---

## 功能概览

### 1) 双向消息转发（话题群组模式）

- 用户首次私聊后，系统为其分配专属话题
- 转发采用 `copyMessage`，尽量保留 Telegram 原始消息实体
- 管理员在话题内回复后，自动映射回对应用户私聊

### 2) 消息类型覆盖

支持文本、图片、视频、语音、音频、文件、贴纸、联系人、位置、投票等常见消息类型。

### 3) 用户验证与并发控制

- 验证类型：
  - 数学题按钮
  - 图片验证码（4 位数字）
  - 图片验证码（5 位字母+数字）
- 支持验证超时和最大尝试次数
- 针对同一用户采用并发锁，避免重复触发验证流程

### 4) 封禁与申诉流程

- 支持临时封禁与永久封禁
- 支持自动解封申诉（可配置开关）
- 管理员可通过 Bot 内联按钮快速处理申诉请求

### 5) 白名单与流量治理

- 白名单用户可跳过验证及频率限制
- 普通用户支持每分钟消息频率限制

### 6) Web 管理后台

- 登录、首次注册、密码找回（2FA）
- 仪表盘统计
- 对话记录与会话删除（可触发重新验证）
- 用户与白名单管理
- 系统设置（Bot、Webhook、验证、功能开关、欢迎语）
- 数据存储切换（KV / D1）及自动同步

### 7) 管理员 Bot 控制面板

管理员私聊 Bot 可执行以下操作：

- 启停验证、申诉、白名单、指令过滤、管理员私聊通知
- 切换验证码类型
- 调整超时与尝试次数
- 调整带内联按钮消息自动撤回时间
- 查看统计、黑名单、用户详情与消息记录

---

## 多语言与 i18n

项目默认语言：`zh-hans`

支持语言（定义于 `shared/i18n.js`）：

| Locale | 显示名称 |
|---|---|
| `zh-hans` | 简体中文 |
| `zh-hant` | 繁體中文 |
| `en` | English |

说明：

- 前端语言可在界面右上角下拉框直接选择
- 机器人语言由 `BOT_LOCALE` 控制
- 更新 `BOT_LOCALE` 或 `BOT_TOKEN` 后，会自动刷新 Bot 命令列表
- 词典采用共享键机制：`zh-hans` 为基础，`zh-hant` / `en` 按键覆盖

---

## 部署说明（Cloudflare）

### 1. Fork 仓库

将本仓库 Fork 到你的 GitHub 账号。

### 2. 创建 Cloudflare Pages 项目

1. 进入 **Cloudflare Dashboard → Workers & Pages**
2. 选择 **Create → Pages → Connect to Git**
3. 绑定你 Fork 的仓库
4. 构建配置：

| 项目 | 值 |
|---|---|
| Framework preset | Vue |
| Build command | `npm run build` |
| Build output directory | `dist` |

### 3. 绑定 KV（必需）

1. Cloudflare Dashboard → **Workers & Pages → KV**
2. 创建命名空间（例如 `tg-bot-kv`）
3. 在 Pages 项目 **Settings → Bindings** 中添加：

| 类型 | 变量名 | 说明 |
|---|---|---|
| KV namespace | `KV` | 必需 |

### 4. 绑定 D1（可选）

如需 SQL 存储能力，可额外绑定：

| 类型 | 变量名 | 说明 |
|---|---|---|
| D1 database | `D1` | 可选 |

> 未绑定 D1 时系统默认使用 KV。  
> 绑定后可在后台的“数据存储”页面进行切换与同步。

### 5. 触发部署

保存绑定后，重新部署项目（Retry deployment）。

---

## 初始化配置

部署完成后，按以下顺序初始化：

1. 首次访问站点，完成管理员账号初始化
2. 进入“系统设置”
3. 配置关键参数：
   - `BOT_TOKEN`（从 @BotFather 获取）
   - `FORUM_GROUP_ID`（已启用话题功能的群组 ID，通常为 `-100...`）
   - `ADMIN_IDS`（管理员 Telegram ID，多个以逗号分隔）
4. 配置 Webhook：
   - `https://你的域名.pages.dev/webhook`
5. 验证 Bot 在线状态并完成消息链路测试

---

## Bot 指令

### 用户指令

- `/start`
- `/help`
- `/status`

### 管理员指令（私聊 Bot）

- `/panel`
- `/stats`
- `/ban <uid>`
- `/unban <uid>`
- `/wl <uid>`
- `/unwl <uid>`
- `/info <uid>`

---

## 项目结构

```text
.
├─ functions/
│  ├─ webhook.js                  # Telegram Webhook 入口
│  ├─ api/
│  │  └─ [[path]].js              # Web 管理 API
│  └─ _shared/
│     ├─ bot.js                   # Bot 业务逻辑（转发、验证、申诉、面板）
│     ├─ bot-i18n.js              # Bot i18n 适配
│     ├─ tg.js                    # Telegram API 封装
│     ├─ auth.js                  # Web 认证与会话
│     ├─ captcha.js               # 验证码生成
│     ├─ totp.js                  # 2FA (TOTP)
│     ├─ db.js                    # 存储路由聚合层（KV / D1）
│     ├─ db-kv.js                 # KV 实现
│     ├─ db-d1.js                 # D1 实现
│     ├─ db-routing.js            # 存储切换与同步
│     └─ db-settings.js           # 默认设置
├─ shared/
│  ├─ i18n.js                     # 前后端共享 i18n
│  └─ locales/
│     ├─ zh-hans.js
│     ├─ zh-hant.js
│     └─ en.js
├─ src/
│  ├─ App.vue
│  ├─ main.js
│  ├─ router/index.js
│  ├─ stores/
│  │  ├─ api.js
│  │  ├─ auth.js
│  │  └─ i18n.js
│  ├─ views/
│  │  ├─ DashboardView.vue
│  │  ├─ ConversationsView.vue
│  │  ├─ UsersView.vue
│  │  ├─ WhitelistView.vue
│  │  ├─ SettingsView.vue
│  │  ├─ ProfileView.vue
│  │  ├─ LoginView.vue
│  │  ├─ RegisterView.vue
│  │  └─ RecoverView.vue
│  └─ components/
│     ├─ NavBar.vue
│     └─ UserSearchPicker.vue
├─ vite.config.js
├─ package.json
└─ README.md
```

---

## 数据与存储

- 默认存储：KV
- 可选存储：D1
- 后台支持在线切换：
  - `kv -> d1`
  - `d1 -> kv`
- 支持切换前全量同步，降低迁移风险

主要数据包括：

- 系统配置
- 用户资料与状态
- 白名单
- 消息记录与最近会话
- Web 管理员账户
- 验证状态

---

## 安全设计

- Webhook Secret 校验：`X-Telegram-Bot-Api-Secret-Token`
- 管理员凭据不以明文持久化，仅保存不可逆的密码学派生结果与随机化参数
- 会话 Token 存储于 KV，支持主动失效（登出）
- TOTP 双因素认证（RFC 6238）
- 验证码 TTL 与尝试次数限制
- 管理员身份保护，避免被普通封禁流程误处理

---

## 常见问题

### 1) 页面提示 `KV 未绑定`

请在 Pages 项目 **Bindings** 中确认已绑定 `KV`，且变量名必须为 `KV`。

### 2) 设置 Webhook 失败

请先确认 `BOT_TOKEN` 已保存，且 Webhook URL 为公网可访问的 HTTPS 地址。

### 3) 用户发消息后未创建话题

请检查：

- 群组已启用话题功能
- Bot 在群组中拥有管理员权限
- `FORUM_GROUP_ID` 填写正确（通常为 `-100...`）

### 4) 无法切换到 D1

请先在 Pages **Bindings** 中绑定 `D1`，并重新部署。

### 5) 需要切换 Bot 文案语言

在系统设置中修改 `BOT_LOCALE`（`zh-hans` / `zh-hant` / `en`），保存后命令会自动刷新。

---

## License

本项目采用 **GNU General Public License v3.0 (GPL-3.0)**。  
详见仓库根目录 `LICENSE` 文件。
