<h1 align="center">🤖 Telegram ChatBot</h1>

<p align="center">
  Telegram 双向消息机器人 · Web 管理后台 · 多存储后端 · 多种验证方式
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat&logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-4169e1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="MIT License">
</p>

<p align="center">
  <a href="./README_EN.md">English</a>
</p>

---

用户私聊 Bot → 自动创建话题 → 管理员回复 → 实时转发回用户。

支持 **Cloudflare Pages** 和 **Docker** 两种部署，存储层支持 **KV / D1 / Hyperdrive（PostgreSQL & MySQL）** 自由切换。

---

---

## ✨ 功能特性

<details>
<summary><b>📨 消息系统</b></summary>

- 双向消息转发（用户 ↔ 管理员话题）
- 独立话题管理（每个用户一个话题）
- 编辑消息同步
- 消息去重（防止重复转发）
- 支持所有消息类型（文字/图片/视频/音频/文件/贴纸/位置/投票等）
- 管理员回复自动转发回用户

</details>

<details>
<summary><b>🔐 验证系统</b>（8 种验证方式）</summary>

| 类型 | 需要密钥 | 需要站点 URL | 说明 |
|------|:--------:|:----------:|------|
| 数学题 | ❌ | ❌ | 随机加减乘除，按钮选择 |
| 图片数字 | ❌ | ✅ | 4 位数字图片验证码 |
| 图片字母数字 | ❌ | ✅ | 5 位字母数字图片验证码 |
| Cloudflare Turnstile | ✅ | ✅ | Cloudflare 无感验证 |
| Google reCAPTCHA v2 | ✅ | ✅ | "我不是机器人"复选框 |
| Google reCAPTCHA v3 | ✅ | ✅ | 无感评分验证 |
| hCaptcha | ✅ | ✅ | hCaptcha 验证控件 |

所有验证方式均支持：
- 超时自动提示并清理
- 失败次数限制
- 白名单用户跳过验证

</details>

<details>
<summary><b>🛡️ 风控系统</b></summary>

- 频率限制（每分钟最大消息数，基于 KV 存储）
- 封禁 / 解封 / 永久封禁
- 用户申诉流程（管理员审批）
- 斜杠命令过滤（`/xxx` 不转发给管理员）
- Zalgo 异常文本过滤
- 关键词过滤（支持 text 和 regex 规则，ReDoS 防护）

</details>

<details>
<summary><b>🖥️ Web 管理后台</b></summary>

- 仪表盘（总用户数、消息统计）
- 对话记录浏览
- 用户管理（封禁/解封/白名单/删除）
- 白名单管理
- 完整设置页面（Bot/Webhook/验证/功能/过滤/欢迎/存储）
- 个人中心（修改密码/用户名/2FA）
- 登录速率限制（可配置最大尝试次数和锁定时长）

</details>

<details>
<summary><b>🗄️ 存储系统</b></summary>

- **KV** — 开箱即用，适合中小规模
- **D1** — SQLite，支持 SQL 查询
- **Hyperdrive** — PostgreSQL / MySQL，适合大规模生产
- 三向一键切换，自动同步数据
- SQL 导入导出（明文 / Base64 / AES-256-GCM 加密）

</details>

<details>
<summary><b>🌍 多语言</b></summary>

- 简体中文 / 繁體中文 / English
- Bot 消息语言和 WebUI 语言独立配置
- 通过设置页面切换 Bot 语言

</details>

---

## 🚀 快速开始

### 最快方式：Docker Compose

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
docker compose up -d
```

访问 `http://localhost:3000`，使用默认账号 `admin` / `admins` 登录。

### 配置顺序

1. 登录 WebUI → **修改密码** → 开启 **2FA**
2. 设置 **Bot Token**（[@BotFather](https://t.me/BotFather) 获取）
3. 设置 **话题群组 ID**（已开启话题的超级群组，系统提供查询辅助）
4. 设置 **管理员 Telegram ID**
5. 设置 **Webhook URL**：`https://你的域名/webhook`
6. 选择验证方式并配置
7. 测试：用户发消息 → 话题创建 → 管理员回复 → 用户收到

---

## 📦 部署指南

<details>
<summary><b>☁️ Cloudflare Pages 部署</b></summary>

### 1. 创建存储资源

**必需 — KV 命名空间：**
Cloudflare Dashboard → Workers & Pages → KV → Create a namespace

**可选 — D1 数据库：**
```bash
npx wrangler d1 create tg-chatbot-d1
```

**可选 — Hyperdrive：**
Dashboard → Hyperdrive → 创建连接（支持 `postgres://` / `mysql://`）

### 2. 创建 Pages 项目

Fork 本仓库 → Workers & Pages → Create → Pages → 连接 GitHub 仓库

| 配置项 | 值 |
|--------|-----|
| 框架预设 | `Vue` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |

### 3. 添加绑定

Settings → Bindings → Add binding：

| 变量名 | 绑定类型 | 必需 |
|--------|----------|:----:|
| `KV` | KV namespace | ✅ |
| `D1` | D1 database | ❌ |
| `HYPERDRIVE` | Hyperdrive | ❌ |

> 使用 Hyperdrive 需额外执行 `npm install pg mysql2` 并在 Settings → Compatibility flags 添加 `nodejs_compat`。

### 4. 部署

推送代码后自动部署，得到 `https://your-project.pages.dev`。

</details>

<details>
<summary><b>🐳 Docker 部署</b></summary>

### 使用 Docker Compose（推荐）

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
docker compose up -d
```

### 使用 Docker 直接运行

```bash
docker pull kakuwari/tg-chatbot:latest
docker run -d \
  -p 3000:3000 \
  -v telegram-data:/app/data \
  --name telegram-chatbot \
  kakuwari/tg-chatbot:latest
```

### 本地构建

```bash
docker build -t telegram-chatbot .
docker run -d -p 3000:3000 -v data:/app/data telegram-chatbot
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `KV_FILE` | `/app/data/kv-store.db` | KV 存储 SQLite 路径 |
| `D1_FILE` | `/app/data/d1-store.db` | D1 存储 SQLite 路径 |
| `DATABASE_URL` | — | PostgreSQL / MySQL 连接串 |
| `ACTIVE_DB` | `kv` | 存储后端：`kv` / `d1` / `hyperdrive` |

### 使用 PostgreSQL

编辑 `docker-compose.yml`，取消 PostgreSQL 服务注释：

```yaml
services:
  telegram-chatbot:
    environment:
      - DATABASE_URL=postgresql://telegram:password@postgres:5432/telegram_bot
      - ACTIVE_DB=hyperdrive

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: telegram_bot
      POSTGRES_USER: telegram
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-telegram_password}
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

### HTTPS 配置

Docker 默认无 HTTPS，需要反向代理：

**Cloudflare Tunnel（推荐）：**
```bash
cloudflared tunnel --url http://localhost:3000
```

**Nginx 反向代理：**
```nginx
server {
    listen 443 ssl;
    server_name bot.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

</details>

---

## ⚙️ 配置说明

<details>
<summary><b>🤖 Bot 配置</b></summary>

| 配置项 | 说明 | 必需 |
|--------|------|:----:|
| `BOT_TOKEN` | Telegram Bot Token（@BotFather 获取） | ✅ |
| `FORUM_GROUP_ID` | 话题超级群组 ID（`-100` 开头） | ✅ |
| `ADMIN_IDS` | 管理员 Telegram ID（逗号分隔） | ✅ |
| `BOT_LOCALE` | 机器人语言：`zh-hans` / `zh-hant` / `en` | ❌ |

**获取群组 ID：** 在 WebUI 设置页面使用"查询聊天 ID"辅助工具，输入群组用户名或链接即可解析。

</details>

<details>
<summary><b>🔗 Webhook 配置</b></summary>

| 配置项 | 说明 |
|--------|------|
| `WEBHOOK_URL` | Webhook 地址，格式：`https://域名/webhook` |

设置 Webhook 后，系统会自动生成 `WEBHOOK_SECRET` 用于验证请求来源。
Cloudflare Pages 部署时，`CAPTCHA_SITE_URL` 会自动从 Webhook URL 提取 origin。

</details>

<details>
<summary><b>🔐 验证配置</b></summary>

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `VERIFICATION_ENABLED` | `true` | 验证开关 |
| `CAPTCHA_TYPE` | `math` | 验证类型（见下方表格） |
| `VERIFICATION_TIMEOUT` | `300` | 超时秒数（60-3600） |
| `MAX_VERIFICATION_ATTEMPTS` | `3` | 最大尝试次数（1-10） |
| `CAPTCHA_SITE_URL` | — | 验证页面站点 URL |

**各验证类型专属配置：**

| 配置项 | 用于类型 |
|--------|----------|
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile |
| `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA v2 |
| `RECAPTCHA_V3_SITE_KEY` / `RECAPTCHA_V3_SECRET_KEY` | Google reCAPTCHA v3 |
| `RECAPTCHA_V3_SCORE_THRESHOLD` | reCAPTCHA v3 最低分数（默认 0.5） |
| `HCAPTCHA_SITE_KEY` / `HCAPTCHA_SECRET_KEY` | hCaptcha |

</details>

<details>
<summary><b>🛡️ 风控配置</b></summary>

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `MAX_MESSAGES_PER_MINUTE` | `30` | 每分钟最大消息数（白名单用户不受限） |
| `AUTO_UNBLOCK_ENABLED` | `true` | 允许封禁用户发起申诉 |
| `WHITELIST_ENABLED` | `false` | 白名单功能（跳过验证和频率限制） |
| `BOT_COMMAND_FILTER` | `true` | 过滤 `/xxx` 指令不转发给管理员 |
| `ADMIN_NOTIFY_ENABLED` | `false` | 管理员私聊消息通知 |
| `ZALGO_FILTER_ENABLED` | `true` | 过滤 Zalgo 异常文本 |
| `MESSAGE_FILTER_RULES` | `[]` | 关键词过滤规则（JSON 数组） |

</details>

<details>
<summary><b>⏰ 消息管理配置</b></summary>

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `USER_MSG_DELETE_SECONDS` | `30` | 用户消息自动撤回时间（0=不撤回） |
| `INLINE_KB_MSG_DELETE_ENABLED` | `true` | 带按钮消息自动撤回开关 |
| `INLINE_KB_MSG_DELETE_SECONDS` | `30` | 带按钮消息自动撤回时间 |
| `WELCOME_ENABLED` | `true` | 欢迎消息开关 |
| `WELCOME_MESSAGE` | — | 欢迎消息内容（支持 HTML） |

</details>

<details>
<summary><b>🔒 安全配置</b></summary>

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `LOGIN_SESSION_TTL` | `86400` | WebUI 登录过期时长（秒） |
| `LOGIN_MAX_ATTEMPTS` | `5` | 登录最大尝试次数（锁定阈值） |
| `LOGIN_LOCKOUT_SECONDS` | `900` | 登录锁定时长（秒，默认 15 分钟） |

密码使用 PBKDF2（600,000 次迭代 SHA-256）哈希存储，支持 TOTP 两步验证。

</details>

---

## 🔐 验证系统

### 验证流程

```
用户首次发消息
    ↓
Bot 发送验证消息（按钮/图片/链接，取决于类型）
    ↓
用户完成验证
    ↓
Bot 标记用户已验证 → 转发之前的消息给管理员
    ↓
后续消息直接转发，无需再次验证
```

### 超时处理

- 超时后 Bot 自动编辑验证消息为"⏳ 验证已超时"
- 清理所有验证相关数据（verify 记录、pending 消息、webverify KV）
- 用户重新发消息即可触发新一轮验证

### 白名单

白名单用户跳过验证和频率限制，通过 WebUI 或 Bot 命令 `/wl <用户ID>` 添加。

---

## 📝 消息过滤（正则）

支持两种过滤规则类型：

| 类型 | 说明 | 示例 |
|------|------|------|
| `text` | 纯文本匹配（不区分大小写） | `spam`、`广告` |
| `regex` | 正则表达式匹配 | `/https?:\/\/t\.me\/\w+/i` |

### 添加规则

**WebUI：** 设置 → 消息过滤 → 选择类型 → 输入内容 → 添加

**Bot 命令：**
```
/addfilter text 关键词
/addfilter regex /https?:\/\/t\.me\/\w+/i
/delfilter 1
/filters
```

### 正则表达式教程

<details>
<summary><b>正则基础语法</b></summary>

| 语法 | 说明 | 示例 |
|------|------|------|
| `.` | 任意单个字符 | `a.c` 匹配 `abc`、`a1c` |
| `*` | 前一个字符重复 0+ 次 | `ab*c` 匹配 `ac`、`abc`、`abbc` |
| `+` | 前一个字符重复 1+ 次 | `ab+c` 匹配 `abc`、`abbc` |
| `?` | 前一个字符可选 | `ab?c` 匹配 `ac`、`abc` |
| `\d` | 数字 `[0-9]` | `\d+` 匹配一个或多个数字 |
| `\w` | 单词字符 `[a-zA-Z0-9_]` | `\w+` 匹配一个单词 |
| `\s` | 空白字符 | `\s+` 匹配一个或多个空格 |
| `[abc]` | 字符集 | `[aeiou]` 匹配任意元音 |
| `[^abc]` | 排除字符集 | `[^0-9]` 匹配非数字 |
| `(abc)` | 分组 | `(ab)+` 匹配 `ab`、`abab` |
| `a\|b` | 或 | `cat\|dog` 匹配 `cat` 或 `dog` |
| `^` | 行首 | `^Hello` 匹配行首的 `Hello` |
| `$` | 行尾 | `end$` 匹配行尾的 `end` |

</details>

<details>
<summary><b>常用过滤正则示例</b></summary>

```
# 匹配 Telegram 邀请链接
/addfilter regex /t\.me\/(joinchat\/|\+)\w+/i

# 匹配所有外链
/addfilter regex /https?:\/\/[^\s]+/i

# 匹配包含手机号的消息
/addfilter regex /\b1[3-9]\d{9}\b/

# 匹配包含"加群"或"进群"的消息
/addfilter regex /加群|进群|入群/

# 匹配纯 emoji 消息（5个以上连续 emoji）
/addfilter regex /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{5,}$/u
```

</details>

<details>
<summary><b>正则测试与调试</b></summary>

### 在线测试工具

在添加复杂正则规则前，建议先用在线工具测试：

- **[regex101.com](https://regex101.com/)** — 最流行的正则测试工具，支持语法高亮和解释
- **[regexr.com](https://regexr.com/)** — 可视化正则匹配
- **[debuggex.com](https://www.debuggex.com/)** — 正则表达式可视化（生成状态机图）

### 测试步骤

1. 打开 [regex101.com](https://regex101.com/)
2. 在 "Test String" 中粘贴要匹配的消息文本
3. 在 "Regular Expression" 中输入你的正则（不含首尾 `/` 和 flags）
4. 右侧选择 flags：`g`（全局）、`i`（不区分大小写）、`m`（多行）
5. 确认匹配结果正确后，在 Bot 中添加：`/addfilter regex /你的正则/flags`

### 注意事项

- 正则匹配目标是消息内容的**纯文本提取**（非原始 JSON），包含文字、用户名、标题等
- 避免使用嵌套量词如 `(a+)+`，会导致 ReDoS（正则拒绝服务）
- 系统会在创建时自动检测并拒绝有 ReDoS 风险的正则
- 匹配目标字符串限制为 4096 字符，防止超长消息导致性能问题
- 正则匹配失败（语法错误等）会静默返回不匹配，不会影响消息处理

</details>

<details>
<summary><b>ReDoS 防护</b></summary>

系统内置了 ReDoS（Regular Expression Denial of Service）防护：

1. **创建时检测**：添加正则规则时，自动检测嵌套量词模式（如 `(a+)+`、`(a|a)+`），拒绝有风险的正则
2. **匹配时保护**：正则匹配包裹在 try-catch 中，目标字符串限制 4096 字符
3. **错误静默**：匹配失败不会影响正常消息处理

如果你的正则被拒绝，说明它包含可能导致灾难性回溯的模式。请简化正则或使用更具体的字符类。

</details>

---

## 🗄️ 存储系统

| 后端 | 适用场景 | 特点 |
|------|----------|------|
| **KV** | 小中型 | 开箱即用，无需额外配置，键值存储 |
| **D1** | 中大型 | SQLite，支持 SQL 查询，事务 |
| **Hyperdrive** | 大型生产 | PostgreSQL / MySQL，外部数据库 |

### 切换存储

在 WebUI 设置 → 存储管理中一键切换，系统自动同步数据。

> ⚠️ 切换前建议停止 Bot 消息处理，避免同步期间数据不一致。

### SQL 导入导出

支持三种模式：
- **明文** — 直接导出 SQL 文本
- **Base64** — Base64 编码
- **AES-256-GCM** — 加密导出，需设置密码

---

## 🛡️ 安全机制

| 机制 | 说明 |
|------|------|
| 密码哈希 | PBKDF2（600,000 次迭代 SHA-256），兼容旧格式 salt:sha256 |
| 两步验证 | TOTP（RFC 6238），支持登录页恢复 |
| 登录速率限制 | 可配置最大尝试次数和锁定时长（默认 5 次/15 分钟） |
| Bot 频率限制 | 基于 KV 的滑动窗口限制（兼容 CF Workers 多隔离环境） |
| Webhook 验证 | Secret Token 校验请求来源 |
| SQL 注入防护 | 所有查询参数化绑定 |
| 默认管理员 | 注册第一个账号后自动禁用 |
| ReDoS 防护 | 正则规则创建时检测、匹配时保护 |
| 正则错误处理 | 匹配异常静默处理，不影响消息流 |

---

## 🛠️ 本地开发

```bash
# 安装依赖
npm install

# 构建前端
npm run build

# 预览构建结果
npm run preview

# Docker 本地开发
cd server && npm install && cd ..
node server/index.js
```

> 完整后端能力依赖 Cloudflare 环境，本地适合前端预览和构建验证。Docker 模式下可完整测试后端功能。

---

## 🩺 常见问题

<details>
<summary><b>WebUI 500 / 白屏</b></summary>

检查 KV 是否绑定且变量名为大写 `KV`。绑定后需重新部署。

Docker 模式下检查 `KV_FILE` 路径是否有写入权限。

</details>

<details>
<summary><b>Webhook 设置失败</b></summary>

- Bot Token 是否正确（格式：`123456:ABC-DEF...`）
- URL 必须是公网 HTTPS：`https://域名/webhook`
- Docker 用户需要配置反向代理提供 HTTPS

</details>

<details>
<summary><b>消息不转发</b></summary>

- 群组是否开启了话题功能（超级群组 → 设置 → 话题）
- Bot 是否为群组管理员（需要管理话题权限）
- `FORUM_GROUP_ID` 是否正确（`-100` 开头的数字）
- 用户是否已通过验证

</details>

<details>
<summary><b>忘记密码</b></summary>

- 已启用 2FA：通过登录页"恢复"功能，使用 TOTP 码重置密码
- 未启用 2FA：需手动修改存储（KV/D1/数据库中删除 web_users 记录，重启后自动重建默认管理员）

</details>

<details>
<summary><b>Docker 无 HTTPS</b></summary>

使用以下方式之一提供 HTTPS：
- **Cloudflare Tunnel**（推荐）：`cloudflared tunnel --url http://localhost:3000`
- **Nginx 反向代理**（见部署指南）
- **Caddy**：自动 HTTPS，配置最简单

</details>

<details>
<summary><b>验证超时无响应</b></summary>

- 检查 `VERIFICATION_TIMEOUT` 设置（默认 300 秒）
- Turnstile/reCAPTCHA 需要正确配置 `CAPTCHA_SITE_URL`
- 未配置密钥时会自动回退到数学题验证
- 查看容器日志：`docker compose logs -f telegram-chatbot`

</details>

<details>
<summary><b>如何查看容器日志</b></summary>

```bash
# 实时查看日志
docker compose logs -f telegram-chatbot

# 查看最近 100 行
docker compose logs --tail 100 telegram-chatbot

# 关键日志关键词
# [web_app_verify] — Web 验证回调
# [verify_timeout] — 验证超时清理
# [api/verify] — 验证 API 操作
```

</details>

---

## 📄 License

以仓库根目录 `LICENSE` 文件为准。
