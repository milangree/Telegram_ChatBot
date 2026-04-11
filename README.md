# 🤖 Telegram 反骚扰双向聊天机器人

> 基于 **Cloudflare Pages + Pages Functions**，通过 GitHub 仓库一键部署，完全无服务器，永久免费。

---

## ✨ 功能

- 📨 双向聊天：用户私聊 Bot → 自动在论坛群组创建话题 → 管理员回复 → 转发给用户
- ✅ 人机验证（数学题）
- 🚫 封禁 / 解封 / 自动申诉
- 🔍 **WebUI 直接查询群组 / 频道 / 用户 ID**，快速填入设置
- 👥 **管理员 ID 标签化管理**，搜索用户后一键添加
- 🖥️ Vue 3 管理后台：对话记录、用户管理、系统设置
- 🔒 首次运行注册管理员，之后禁止注册

---

## 🚀 一键部署（GitHub → Cloudflare Pages）

### 第 1 步：Fork 本仓库

点击 GitHub 右上角 **Fork** 按钮，将仓库复制到你的账号下。

---

### 第 2 步：准备 Cloudflare 资源

登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。

#### 2-1 创建 D1 数据库

1. 左侧菜单 → **Workers & Pages** → **D1 SQL Database**
2. 点击 **Create database**，名称随意（如 `tg-bot`），记录弹出的 **database_id**

#### 2-2 创建 KV 命名空间

1. 左侧菜单 → **Workers & Pages** → **KV**
2. 点击 **Create a namespace**，名称随意（如 `tg-kv`），记录弹出的 **id**

---

### 第 3 步：修改 wrangler.toml

在你 Fork 的仓库中，编辑 `wrangler.toml`，填入上面得到的 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "tg-bot"          # ← 改成你创建的数据库名
database_id   = "xxxx-xxxx-xxxx" # ← 改成你的 D1 database_id

[[kv_namespaces]]
binding = "KV"
id      = "yyyy-yyyy-yyyy"        # ← 改成你的 KV id
```

提交（Commit）此修改。

---

### 第 4 步：在 Cloudflare Pages 中部署

1. 左侧菜单 → **Workers & Pages** → **Create**
2. 点击 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub，选择你 Fork 的仓库
4. 构建配置：

   | 字段 | 值 |
   |------|----|
   | Framework preset | `Vue` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

5. 点击 **Save and Deploy**

部署完成后你会得到一个地址，例如：
```
https://tg-bot.pages.dev
```

> ⚠️ **第一次部署会失败**，因为 D1/KV 绑定需要在下一步手动配置。继续操作即可。

---

### 第 5 步：添加 D1 / KV 绑定

1. Pages 项目 → **Settings** → **Bindings**
2. 添加 **D1 database** 绑定：
   - Variable name：`DB`（必须大写，不能改）
   - D1 database：选择你的数据库
3. 添加 **KV namespace** 绑定：
   - Variable name：`KV`（必须大写，不能改）
   - KV namespace：选择你的 KV
4. 点击 **Save**

---

### 第 6 步：重新部署

在 Pages → **Deployments** → 点击最近一次部署旁的 **⋯** → **Retry deployment**

成功后即可访问 WebUI。

---

## ⚙️ 第 7 步：初始化配置

### 7-1 注册管理员账号

打开 Pages 地址，系统自动跳转注册页，填写用户名和密码创建**唯一管理员账号**。

### 7-2 配置 Bot

进入 **⚙️ 系统设置**：

1. **Bot Token**：在 [@BotFather](https://t.me/BotFather) 创建 Bot 后获取
2. 点击「**测试**」按钮验证 Token 是否有效
3. **论坛群组 ID**：填入群组 ID 后点击「**🔍 解析**」，确认无误后点「使用此 ID」
4. **查询任意群组 / 频道 ID**：在「查询群组/频道 ID」处输入 `@username` 后点查询，可一键设为群组或管理员
5. **管理员 ID**：搜索用户后点击添加，或直接输入 ID
6. 点击「**💾 保存设置**」

### 7-3 设置 Webhook

在「🔗 Webhook」区域填入：
```
https://你的Pages地址/webhook
```
点击「**设置 Webhook**」，显示成功提示即完成。

---

## 🔍 如何获取群组 / 用户 ID

| 方法 | 说明 |
|------|------|
| WebUI 设置页「查询群组/频道 ID」 | 输入 @username 自动解析 |
| WebUI 设置页管理员搜索框 | 搜索已发过消息的用户，直接添加 |
| [@userinfobot](https://t.me/userinfobot) | 获取自己的 Telegram ID |
| 将 Bot 加群后发消息 | Bot 在话题卡片中显示用户 ID |

---

## 📁 项目结构

```
├── functions/               # Cloudflare Pages Functions（后端）
│   ├── webhook.js           # Telegram Webhook 入口
│   ├── api/[[path]].js      # WebUI REST API
│   └── _shared/
│       ├── db.js            # D1 数据库操作
│       ├── auth.js          # 会话认证
│       ├── tg.js            # Telegram API 封装
│       └── bot.js           # Bot 消息处理逻辑
├── src/                     # Vue 3 前端
│   ├── views/               # 页面组件
│   ├── components/          # 通用组件（含用户搜索选择器）
│   ├── stores/              # Pinia 状态管理
│   └── router/              # 路由
├── wrangler.toml            # Cloudflare 配置（填写 ID 后提交）
├── vite.config.js
└── package.json
```

---

## 🔧 常见问题

**Q：部署后 WebUI 打不开？**
A：检查 D1/KV 绑定是否已添加，绑定名称必须是 `DB` 和 `KV`（大写）。

**Q：Webhook 设置失败？**
A：先保存 Bot Token，再填写 Webhook URL（格式：`https://xxx.pages.dev/webhook`）。

**Q：用户发消息，群组没有出现话题？**
A：检查群组是否开启「话题功能」，Bot 是否为管理员并拥有「管理话题」权限，FORUM_GROUP_ID 是否为负数。

**Q：如何更新代码？**
A：在 Fork 的仓库中合并上游更新，Cloudflare Pages 会自动重新部署。

**Q：免费套餐限制？**
A：Pages Functions 每天 10 万次调用；D1 免费 500MB；KV 免费 10 万次读/天。普通使用完全足够。
