# 🤖 Telegram 双向消息机器人

> 基于 **Cloudflare Pages + KV（可选 D1 SQL）**，GitHub 一键部署，完全无服务器，永久免费。

---

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| 📨 双向消息转发 | 用户私聊 Bot → 论坛话题（按用户 UID 自动创建）→ 管理员回复转发回用户 |
| 🖼️ 全格式支持 | 文字、图片、视频、音频、文件、贴纸、语音、位置、投票等全类型转发 |
| 🗂️ 等宽/代码/引用 | 使用 copyMessage 保留所有 Telegram 消息实体格式 |
| 🔐 多种人机验证 | 数学题 / 图片数字(4位) / 图片字母+数字(5位)，2×2 按钮布局 |
| 🚫 封禁管理 | 临时封禁、永久封禁、自助申诉、WebUI 管理 |
| ⚪ 白名单 | 白名单用户跳过验证和频率限制 |
| 👤 用户头像 | 首次收到消息时发送带头像的用户卡片，WebUI 中显示头像 |
| 🌙 明暗主题 | WebUI 支持深色/浅色模式一键切换 |
| 📱 手机适配 | 侧边栏响应式抽屉，对话界面移动端优化 |
| 🗄️ 双存储 | KV（默认）或 D1 SQL，WebUI 中一键切换并自动同步数据 |
| 🔑 2FA 登录 | 支持「密码登录」或「仅验证码登录」两种方式 |
| 👤 用户信息管理 | 支持用户信息查看、白名单与封禁管理 |

---

## 🚀 部署教程

### 第 1 步：Fork 仓库

点击 GitHub 右上角 **Fork** 将本仓库复制到你的账号。

---

### 第 2 步：创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. **Workers & Pages → KV → Create a namespace**
3. 名称随意（如 `tg-bot-kv`），记录生成的命名空间 ID

---

### 第 3 步：（可选）创建 D1 数据库

> 默认使用 KV 存储，如需 SQL 查询能力可添加 D1：

1. **Workers & Pages → D1 SQL Database → Create database**
2. 名称随意（如 `tg-bot-d1`）

---

### 第 4 步：在 Cloudflare Pages 中部署

1. **Workers & Pages → Create → Pages → Connect to Git**
2. 授权 GitHub，选择 Fork 的仓库
3. 构建配置：

   | 字段 | 值 |
   |---|---|
   | Framework preset | `Vue` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. 点击 **Save and Deploy**

---

### 第 5 步：添加绑定

Pages 项目 → **Settings → Bindings**：

| 类型 | 变量名 | 选择 |
|---|---|---|
| KV namespace | `KV` | 第 2 步创建的命名空间 |
| D1 database（可选） | `D1` | 第 3 步创建的数据库 |

保存后 **Retry deployment**。

---

### 第 6 步：初始化配置

1. 打开部署地址，首次访问自动跳转注册页，或使用默认账号 **admin / admins** 登录
2. 登录后立即修改密码（个人设置）
3. 进入 **⚙️ 系统设置**：
   - 填写 **Bot Token**（[@BotFather](https://t.me/BotFather) 创建 Bot 后获取），点击「测试」验证
   - 填写 **论坛群组 ID**，点击「🔍 解析」确认，点「使用此 ID」
   - 填写 **管理员 Telegram ID**（自己的 ID）
   - 点击「💾 保存设置」

4. 填写 Webhook URL → 点击「设置 Webhook」：
   ```
   https://你的域名.pages.dev/webhook
   ```
   设置成功后 Bot 命令列表自动更新。

---

## 📋 Bot 指令

### 用户可见指令

| 指令 | 说明 |
|---|---|
| `/start` | 显示欢迎消息和快捷按钮 |
| `/help` | 显示帮助信息 |
| `/status` | 查看当前账号状态（验证、封禁情况）|

### 管理员专属指令（私聊 Bot）

| 指令 | 说明 |
|---|---|
| `/panel` | 打开管理员控制台（内联按钮）|
| `/stats` | 查看统计数据 |
| `/ban <uid>` | 封禁用户 |
| `/unban <uid>` | 解封用户 |
| `/wl <uid>` | 将用户加入白名单 |
| `/unwl <uid>` | 将用户移出白名单 |
| `/info <uid>` | 查看用户详情（含内联操作按钮）|

> 管理员直接向 Bot 私聊任何内容会显示控制台面板；在论坛话题中回复消息会自动转发给对应用户。

---

## 🔘 管理员内联按钮说明

话题卡片和 `/info` 命令均会显示完整操作按钮：

| 按钮 | 功能 |
|---|---|
| 🚫 封禁 / ✅ 解封 | 切换用户封禁状态 |
| ♾️ 永封 | 永久封禁（不可申诉）|
| 📋 详情 | 查看用户详细信息 |
| ⚪ 白名单 | 切换白名单（已在则移出）|
| 📨 消息记录 | 分页查看消息历史 |
| 🔄 刷新 | 刷新卡片显示 |

---

## 📁 项目结构

```
├── functions/
│   ├── webhook.js                 # Telegram Webhook 入口
│   ├── api/[[path]].js            # WebUI REST API
│   └── _shared/
│       ├── db.js                  # KVStore + D1Store 双存储层
│       ├── auth.js                # 会话认证
│       ├── tg.js                  # Telegram Bot API 封装
│       ├── bot.js                 # 消息处理与业务逻辑
│       ├── totp.js                # RFC 6238 TOTP 实现
│       └── captcha.js             # 纯 JS PNG 验证码生成
├── src/                           # Vue 3 前端
│   ├── views/
│   │   ├── DashboardView.vue
│   │   ├── ConversationsView.vue
│   │   ├── UsersView.vue
│   │   ├── WhitelistView.vue      # 白名单管理
│   │   ├── SettingsView.vue
│   │   ├── ProfileView.vue
│   │   ├── LoginView.vue          # 支持密码/纯TOTP两种登录
│   │   ├── RegisterView.vue
│   │   └── RecoverView.vue
│   ├── stores/
│   │   ├── auth.js
│   │   └── api.js
│   └── router/index.js
├── index.html
├── vite.config.js
└── package.json
```

---

## 🔧 常见问题

**Q：WebUI 打不开 / 返回 500？**
A：检查 KV 绑定是否存在，变量名必须是 `KV`（大写）。

**Q：Webhook 设置失败？**
A：先保存 Bot Token，再填写 Webhook URL（格式：`https://xxx.pages.dev/webhook`）。

**Q：用户发消息后群组没有出现话题？**
A：依次检查：① 群组已开启「话题功能」；② Bot 已设为群组管理员并拥有「管理话题」权限；③ `FORUM_GROUP_ID` 填写的是以 `-100` 开头的完整负数 ID。

**Q：图片验证码发送失败？**
A：图片验证码通过 Telegram 服务器拉取，需要公开可访问的 URL。设置 Webhook 时会自动填写站点 URL，也可在设置中手动填写 `CAPTCHA_SITE_URL`。

**Q：如何切换到 D1 SQL 数据库？**
A：在 Pages 绑定中添加 D1（变量名 `D1`），重新部署后进入「系统设置 → 数据存储」点击「D1 SQL」按钮，系统会自动同步全量数据再切换。

**Q：如何找回密码？**
A：需提前启用 2FA，在登录页点击「找回密码」，通过 TOTP 验证码重置。未启用 2FA 则需在 KV 控制台删除 `webuser:admin` 键后重新注册。

**Q：免费套餐够用吗？**
A：Pages Functions 每天 10 万次请求，KV 每天 10 万次读取，D1 每天 500 万行读取，普通用量完全免费。

---

## 🛡️ 安全说明

- Webhook 请求通过 `X-Telegram-Bot-Api-Secret-Token` 头验证，防止伪造
- 密码使用随机盐 + SHA-256 哈希，不可逆
- 会话 Token 存于 KV，24 小时 TTL，登出时立即销毁
- 2FA 基于标准 RFC 6238 TOTP（HMAC-SHA1），兼容所有主流 Authenticator 应用
- 图片验证码在纯 JS 中生成，无第三方依赖，验证码 ID 随机不可预测
