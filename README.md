# 🤖 Telegram 反骚扰双向聊天机器人

> 基于 **Cloudflare Pages + Pages Functions + KV**，通过 GitHub 仓库一键部署，完全无服务器，永久免费。

---

## ✨ 功能特性

- 📨 **双向消息转发**：用户私聊 Bot → 自动在论坛群组创建话题 → 管理员回复 → 实时转发给用户
- 🔐 **人机验证**：支持数学题 / 图片验证码（数字、字母数字），降低机器人骚扰
- 🚫 **封禁管理**：支持封禁 / 解封 / 永久封禁 / 用户自助申诉
- 📊 **数据统计**：总用户数、今日消息量、封禁人数实时展示
- 🖥 **Vue 3 管理后台**：对话记录、用户管理、系统设置、Bot 配置一站式管理
- 🌐 **多语言 i18n**：简体中文 / 繁體中文 / English（前后端统一文案）
- 🔒 **安全认证**：首次部署自动初始化管理员，支持 TOTP 两步验证（2FA）
- 🔑 **密码找回**：通过 2FA 验证码重置密码，无需联系服务商
- 🔄 **自动同步上游**：内置 GitHub Actions 定时同步上游仓库更新

---

## 🚀 部署教程（GitHub → Cloudflare Pages）

### 第 1 步：Fork 本仓库

点击 GitHub 右上角 **Fork**，将仓库复制到你自己的账号下。

---

### 第 2 步：准备 Cloudflare KV 命名空间

登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。

1. 左侧菜单 → **Workers & Pages** → **KV**
2. 点击 **Create a namespace**，名称随意（例如 `tg-bot-kv`）
3. 记录创建后显示的命名空间 **ID**（备用）

> 默认使用 KV。项目也支持可选 D1（在设置页可进行 KV / D1 切换与同步），但首次部署只配置 KV 即可运行。

---

### 第 3 步：在 Cloudflare Pages 中部署

1. 左侧菜单 → **Workers & Pages** → **Create**
2. 点击 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub，选择你 Fork 的仓库
4. 构建配置如下：

   | 字段 | 值 |
   |---|---|
   | Framework preset | `Vue` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

5. 点击 **Save and Deploy**

部署完成后你会得到一个访问地址，例如：

```
https://tg-bot.pages.dev
```

> ⚠️ **第一次部署可能失败**，因为 KV 绑定还未添加。继续下一步即可。

---

### 第 4 步：添加 KV 绑定

1. Pages 项目 → **Settings** → **Bindings**
2. 点击 **Add binding** → 选择 **KV namespace**
3. 填写：
   - **Variable name**：`KV`（必须大写，不可修改）
   - **KV namespace**：选择第 2 步创建的命名空间
4. 点击 **Save**

---

### 第 5 步：重新部署

Pages → **Deployments** → 点击最近一次部署旁的 **⋯** → **Retry deployment**

成功后即可访问 WebUI。

---

## ⚙️ 初始化配置

### 获取管理员密码

首次部署后，系统会自动在 KV 中生成管理员账号 `admin`，初始密码存储于 KV 键 `init:default_admin_pw`（1 小时后自动删除）。

在 Cloudflare Dashboard → **KV** → 选择你的命名空间 → 搜索键 `init:default_admin_pw`，即可查看初始密码。

登录后请立即在「个人设置」中修改密码。

---

### 配置 Bot

打开 Pages 地址并登录，进入 **⚙️ 系统设置**：

1. **Bot Token**：在 [@BotFather](https://t.me/BotFather) 创建 Bot 后粘贴 Token，点击「**测试**」验证
2. **论坛群组 ID**：填入群组 ID，点击「**🔍 解析**」确认后点「使用此 ID」
3. **管理员 ID**：搜索已发过消息的用户直接添加，或手动输入 Telegram ID
4. 按需调整验证、限速等选项
5. 点击「**💾 保存设置**」

---

### 设置 Webhook

在「🔗 Webhook」区域填入：

```
https://你的Pages地址/webhook
```

点击「**设置 Webhook**」，出现成功提示即完成。

---

## 🔍 如何获取群组 / 用户 ID

| 方法 | 说明 |
|---|---|
| WebUI 设置页「查询群组/频道 ID」 | 输入 `@username` 自动解析，一键填入 |
| WebUI 用户管理搜索框 | 搜索已发过消息的用户，直接点击添加为管理员 |
| [@userinfobot](https://t.me/userinfobot) | 获取自己的 Telegram ID |
| 将 Bot 加入群组后发消息 | Bot 会在话题卡片中显示用户 ID |

---

## 📁 项目结构

```
├── functions/                      # Cloudflare Pages Functions（后端）
│   ├── webhook.js                  # Telegram Webhook 入口
│   ├── api/[[path]].js             # WebUI REST API
│   └── _shared/
│       ├── bot.js                  # Bot 核心业务逻辑（含 i18n）
│       ├── bot-i18n.js             # Bot i18n 封装
│       ├── db.js                   # KV / D1 路由数据库层
│       ├── auth.js                 # 会话认证 & 工具函数
│       ├── tg.js                   # Telegram Bot API 封装
│       └── totp.js                 # RFC 6238 TOTP 两步验证
├── shared/                         # 前后端共享 i18n 资源
│   ├── i18n.js
│   └── locales/
├── src/                            # Vue 3 前端
│   ├── views/                      # 页面组件
│   ├── components/                 # 通用组件
│   ├── stores/                     # Pinia 状态管理
│   └── router/                     # 路由配置
├── .github/workflows/
│   └── sync-upstream.yml           # 定时同步上游工作流
├── index.html
├── vite.config.js
└── package.json
```

---

## 🔧 常见问题

**Q：WebUI 打不开 / 返回 500？**
- A：检查 KV 绑定是否已添加，变量名必须是 `KV`（大写）。在 Pages → Settings → Bindings 中确认。

**Q：Webhook 设置失败？**
- A：请先在设置页填写并保存 Bot Token，再填写 Webhook URL（格式：`https://xxx.pages.dev/webhook`）。

**Q：用户发消息，群组里没有出现新话题？**
- A：请依次检查：① 群组已开启「话题功能」；② Bot 已设为群组管理员并拥有「管理话题」权限；③ `FORUM_GROUP_ID` 填写的是负数 ID（超级群组 ID 以 `-100` 开头）。

**Q：如何找回密码？**
- A：若已启用 2FA，可在登录页点击「找回密码」，通过 TOTP 验证码重置。若未启用 2FA，需在 Cloudflare KV 中手动删除对应的 `webuser:` 键后重新注册。
**Q：如何更新代码？**
- A：仓库已内置 `.github/workflows/sync-upstream.yml`，默认每 6 小时自动尝试 fast-forward 同步上游 `milangree/Telegram_ChatBot` 的 `main` 分支；同步成功后 Cloudflare Pages 会自动触发重部署。也可在 Actions 页面手动运行并指定上游仓库/分支。

**Q：免费套餐够用吗？**
- A：完全够用。Pages Functions 每天 10 万次调用，KV 每天 10 万次读取 / 1000 次写入，存储上限 1GB。

---

## 🛡 安全说明

- Webhook 请求通过 `X-Telegram-Bot-Api-Secret-Token` 头验证，防止伪造请求
- 密码使用随机 salt + SHA-256 hash 存储，不可逆
- 会话 Token 存储于 KV，TTL 24 小时，登出时立即销毁
- 2FA 基于标准 RFC 6238 TOTP 实现，兼容 Google Authenticator 等主流应用
