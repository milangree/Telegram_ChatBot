<h1 align="center">🤖 Telegram ChatBot</h1>

<p align="center">
  ☁️ 面向 Cloudflare Pages 的 Telegram 双向消息机器人与 Web 管理后台
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?style=flat&logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Vite-Build-646cff?style=flat&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Cloudflare-Pages_Functions-f38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Pages Functions">
  <img src="https://img.shields.io/badge/Storage-KV%20%2F%20D1-2f6feb?style=flat" alt="KV / D1">
  <img src="https://img.shields.io/badge/Auth-2FA%20%2F%20Session-8a63d2?style=flat" alt="2FA / Session">
</p>

> 一个基于 **Cloudflare Pages + Pages Functions + KV / D1 + Vue 3** 的 Telegram 双向聊天机器人项目，支持话题群组转发、人机验证、多语言、2FA 登录、Webhook 管理与可视化后台配置。

用户向 Bot 私聊发送消息后，机器人会自动在管理员话题群组（超级群组）中创建对应话题；管理员在话题中的回复会被实时转发回用户，实现完整的双向沟通链路。

---

## 目录

- [更新与规划](#更新与规划)
- [项目简介](#项目简介)
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
- [项目脚本](#项目脚本)
- [故障排除](#故障排除)
- [安全说明](#安全说明)
- [更新项目](#更新项目)
- [License](#license)
- [致谢](#致谢)

---

## 🗺️ 更新与规划

### 当前已完成能力（基于代码整理）

- **Webhook 与 Bot 基础能力**
  - 已实现 `/webhook` 入口
  - 已支持 `X-Telegram-Bot-Api-Secret-Token` 校验
  - 已支持自动设置 / 删除 Webhook
  - 已支持 Bot Commands 自动刷新

- **双向消息与话题映射**
  - 用户私聊消息转发到管理员话题群组
  - 按用户自动创建独立话题
  - 管理员话题回复转发回用户
  - 已包含消息去重与部分编辑同步处理逻辑

- **风控与人机验证**
  - 已支持数学题验证
  - 已支持图片验证码（数字 / 字母数字）
  - 已支持验证超时、最大尝试次数与频率限制
  - 已支持白名单、封禁、申诉相关流程

- **WebUI 管理后台与账号体系**
  - 已支持首次注册 / 默认管理员兜底机制
  - 已支持用户名密码登录
  - 已支持 2FA 启用、校验与找回密码
  - 已支持会话 Token、鉴权与退出登录

- **后台配置与运维能力**
  - 已支持 Bot Token 测试
  - 已支持 Webhook URL 保存
  - 已支持管理员 ID、群组 ID、欢迎消息、验证策略等配置项管理
  - 已支持清空机器人业务数据并保留 WebUI 账号

- **数据存储与迁移能力**
  - 已完成 KV / D1 双存储抽象
  - 已支持自动修复、同步与切换存储
  - 已支持 SQL 导出 / 导入
  - 已支持消息、用户、白名单、最近会话等业务数据统一管理

- **多语言与界面基础**
  - 已支持简体中文、繁體中文、English
  - 已实现前后端共享 i18n 文案结构
  - 已具备仪表盘、会话、用户、白名单、设置、个人中心等页面

### 下一阶段计划

- **Google 网页验证**
  - 增加 Google Search Console 相关网页验证支持
  - 支持站点所有权验证所需内容接入
  - 为后续搜索收录与站点管理打基础

- **Cloudflare 网页验证**
  - 增加 Cloudflare 侧网页 / 域名验证支持
  - 适配 Cloudflare Pages 场景下的验证需求
  - 为自定义域名和平台侧接入流程提供辅助

- **将网页验证接入后台设置**
  - 计划在 WebUI 中集中管理验证信息
  - 减少手动修改页面文件或部署内容的成本
  - 让部署后配置流程更完整

- **补充验证相关部署文档**
  - 增加 Google 与 Cloudflare 网页验证操作说明
  - 明确在 Cloudflare Pages 中的推荐配置方式
  - 补充常见问题与排查步骤

---

## 📖 项目简介

Telegram ChatBot 是一套面向 Cloudflare Pages 生态设计的 Telegram 管理机器人系统。项目核心目标不是只完成消息转发，而是提供一个可以直接部署、可视化管理、支持安全验证和多语言的完整后台方案。

项目由以下部分组成：

- **Cloudflare Pages 前端管理后台**
- **Cloudflare Pages Functions API**
- **Telegram Webhook 处理入口**
- **KV / D1 双存储后端**
- **共享式前后端 i18n 文案系统**

它适合希望快速搭建 Telegram 客服式、工单式、话题式双向沟通系统的场景。

---

## ✨ 项目特色

| 模块 | 描述 |
| :--- | :--- |
| 双向消息转发 | 用户私聊 Bot 后，消息自动进入管理员话题群组，管理员回复再实时转发回用户。 |
| 独立话题管理 | 每位用户映射独立话题，便于区分不同用户及追溯消息上下文。 |
| 编辑同步与去重 | 支持一定时间窗口内的管理员消息编辑同步，并对重复消息进行处理。 |
| 人机验证系统 | 支持数学题按钮验证、4 位数字图片验证码、5 位字母数字图片验证码。 |
| 风控能力 | 支持频率限制、白名单、封禁 / 解封 / 永久封禁、申诉流程等。 |
| 管理后台 | 提供仪表盘、对话记录、用户管理、白名单、设置、个人中心等页面。 |
| 认证能力 | 支持首次初始化管理员、用户名密码登录、2FA、密码找回、会话管理。 |
| Webhook 管理 | 支持 Webhook URL 设置、Webhook Secret 管理、Bot Commands 刷新。 |
| 存储切换 | 支持 KV 与 D1 之间同步后切换，并支持 SQL 导入导出。 |
| 多语言 | 支持简体中文、繁體中文、English。 |

### 核心消息能力

- 用户私聊 Bot
- 自动在话题群组（超级群组）内创建独立话题
- 管理员在话题中回复
- 自动转发回用户
- 删除会话时支持关闭对应群组话题
- 非白名单用户在重新对话时可再次触发验证

### 风控与验证能力

- 数学题按钮验证
- 图片验证码（4 位数字）
- 图片验证码（5 位字母数字）
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
│       ├── db.js                     # 数据库统一抽象
│       ├── db-kv.js                  # KV 实现
│       ├── db-d1.js                  # D1 实现
│       ├── db-routing.js             # KV / D1 路由与同步
│       ├── db-settings.js            # 默认设置项
│       ├── db-sql.js                 # SQL 导入导出
│       ├── tg.js                     # Telegram Bot API 封装
│       └── totp.js                   # TOTP 两步验证实现
├── shared/
│   ├── display-name.js
│   ├── i18n.js                       # 共享 i18n 工具
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

- **functions/webhook.js**  
  Telegram 更新入口，负责接收并处理 Telegram 推送的 webhook 请求。

- **functions/api/[[path]].js**  
  WebUI 后端 API，负责鉴权、设置、用户管理、对话管理、存储切换等功能。

- **functions/_shared/bot.js**  
  机器人核心逻辑，包含消息处理、验证逻辑、话题映射、管理员操作等流程。

- **functions/_shared/db.js**  
  数据层统一抽象，屏蔽 KV / D1 的差异。

- **src/views/**  
  后台主要页面，包括仪表盘、登录、设置、会话、用户、白名单、个人中心等。

---

## 🚀 快速开始

### 环境要求

- Node.js
- npm
- Cloudflare Pages 账号
- Cloudflare KV（必需）
- Cloudflare D1（可选）
- Telegram Bot Token

### 本地准备

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
npm install
npm run build
```

### 部署方式

推荐使用：

**GitHub 仓库 → Cloudflare Pages 自动部署**

这是本项目当前最适合的部署方式。

---

## ☁️ Cloudflare Pages 部署

### 步骤 1：Fork 或导入仓库

将本仓库 Fork 到你自己的 GitHub 账号，或直接克隆后推送到你自己的仓库。

### 步骤 2：准备 Cloudflare 资源

#### 必需资源：KV

登录 Cloudflare Dashboard 后创建一个 KV 命名空间：

1. 进入 **Workers & Pages**
2. 打开 **KV**
3. 点击 **Create a namespace**
4. 名称可自定义，例如：

```text
tg-chatbot-kv
```

#### 可选资源：D1

项目默认可直接使用 KV。  
如果你希望使用 SQL 数据库，可以额外创建 D1，并在 Pages 项目中绑定后，在系统设置中切换到 D1。

### 步骤 3：创建 Cloudflare Pages 项目

1. 打开 **Workers & Pages**
2. 点击 **Create**
3. 选择 **Pages**
4. 连接 GitHub 仓库
5. 选择本项目仓库
6. 填写构建参数：

| 配置项 | 值 |
| :---: | :---: |
| 框架预设 | `Vue` |
| 构建命令 | `npm run build` |
| 构建输出目录 | `dist` |

7. 开始部署

> 如果第一次部署失败，通常是因为还没有绑定 KV，这属于正常现象，继续下一步即可。

### 步骤 4：添加绑定

#### 绑定 KV

在 Pages 项目中进入：

**Settings → Bindings → Add binding**

类型选择 **KV Namespace**，并填写：

| 字段 | 值 |
| :---: | :---: |
| 变量名 | `KV` |
| 命名空间 | 你创建的 KV 命名空间 |

> `KV` 变量名必须保持一致，不能改成其他名称。

#### 绑定 D1（可选）

如果你创建了 D1，也可以继续添加：

| 字段 | 值 |
| :---: | :---: |
| 变量名 | `D1` |
| 数据库 | 你的 D1 数据库 |

### 步骤 5：重新部署

完成 KV（和可选 D1）绑定后，重新部署 Pages 项目。

成功后你会得到一个站点地址，例如：

```text
https://your-project.pages.dev
```

---

## 🔐 首次访问与初始化

### 默认管理员账号

项目在首次部署后，会自动准备管理员登录环境。

**默认用户名**

```text
admin
```

**默认密码获取方式**

初始密码会临时存储在 KV 中，键名通常为：

```text
init:default_admin_pw
```

你可以在 Cloudflare Dashboard 的 KV 中搜索这个键并查看值。

> 该密码是临时的，读取后请尽快登录 WebUI，并在“个人设置”中修改密码。

### 登录 WebUI

打开你的 Pages 域名，进入登录页后：

- 使用默认管理员账号登录
- 如启用了 2FA，可切换到 2FA 登录方式
- 如忘记密码，且已启用 2FA，可在“找回密码”中重置

---

## 🧭 使用指南

### 首次建议配置

登录后，优先完成以下配置：

1. 配置 Bot Token  
   在 [@BotFather](https://t.me/BotFather) 创建机器人，获取 Token 后填入系统设置。

2. 配置话题群组 ID（超级群组）  
   填写管理员话题群组 ID（超级群组 ID）。  
   系统支持使用“解析 / 查询群组 ID”功能辅助获取目标群组信息。

3. 配置管理员 Telegram ID  
   支持通过以下方式添加：
   - 直接输入 Telegram ID
   - 搜索已和 Bot 交互过的用户
   - 使用“设为管理员”快捷按钮

4. 设置 Webhook URL  
   格式如下：

   ```text
   https://你的-pages-域名/webhook
   ```

   配置成功后，系统会自动向 Telegram 设置 Webhook。

5. 按需调整安全与功能开关  
   建议根据需求配置：
   - 是否启用验证
   - 验证类型
   - 申诉开关
   - 白名单功能
   - 带按钮消息自动撤回
   - 每分钟最大消息数

### 系统工作流程

#### 用户消息流程

1. 用户向 Bot 私聊发送消息
2. Bot 检查：
   - 是否已封禁
   - 是否需要人机验证
   - 是否超过频率限制
3. Bot 将消息转发到管理员话题群组（超级群组）
4. 若该用户没有对应话题，则自动创建新话题
5. 管理员在话题内回复
6. 回复被转发回用户
7. 消息记录写入存储（KV / D1）

#### 管理员消息流程

1. 管理员在话题群组中的对应话题内发送消息
2. 系统根据 thread 映射定位用户
3. 将消息发送给对应 Telegram 用户
4. 记录管理员消息与映射关系
5. 若管理员后续编辑消息，则在允许时间窗口内同步更新给用户

### Telegram Bot 所需权限

如果 Bot 需要在话题群组（超级群组）中正常工作，通常需要以下权限：

- 发送消息
- 读取消息
- 管理话题 / 创建话题
- 删除消息
- 置顶消息（如未来扩展使用）

并确保目标群组已经开启 **话题功能**。

### 推荐配置顺序

1. 登录 WebUI
2. 修改默认管理员密码
3. 开启 2FA
4. 配置 Bot Token
5. 配置话题群组 ID（超级群组）
6. 设置管理员 Telegram ID
7. 设置 Webhook
8. 测试用户发消息 → 群组创建话题 → 管理员回复 → 用户收到消息
9. 根据实际需求开启白名单、验证、自动撤回等功能

---

## ⚙️ 配置说明

### Bot 配置

- **Bot Token**：机器人凭据
- **话题群组 ID（超级群组）**：管理员讨论区所属群组
- **管理员 Telegram ID**：允许作为管理端与 Bot 交互的 Telegram 用户

### Webhook

- **Webhook URL**：Telegram 推送更新的地址
- 设置后系统会自动更新相关 Bot 命令

### 人机验证

- **启用验证**
- **验证类型**
  - 数学题
  - 图片数字
  - 图片字母数字
- **验证码站点 URL**
- **验证超时**
- **最多尝试次数**

### 功能配置

- **自动解封申诉**
- **白名单功能**
- **过滤机器人指令**
- **接收管理员私聊消息**
- **每分钟最大消息数**
- **带按钮消息自动撤回**
- **撤回秒数**

### 欢迎消息

- 是否启用 `/start` 欢迎消息
- 支持 HTML 格式内容

### 数据存储

- 当前使用 **KV** 或 **D1**
- 可在设置页执行存储切换
- 支持 SQL 导出 / 导入（KV / D1 均可）
- 支持清空机器人数据，但保留 WebUI 登录账号

### 安全与认证

- 首次注册 / 默认管理员机制
- 用户名 + 密码登录
- 用户名 + 2FA 验证码登录
- 已启用 2FA 的账号支持找回密码
- 会话 Token 登录、鉴权、登出和过期校验

---

## 🗄️ 数据存储说明

项目支持两种后端存储：

### 1. KV

优点：

- 配置简单
- 部署方便
- 对小中型机器人足够实用

适合：

- 轻量部署
- 快速上线
- 免费额度优先

### 2. D1

优点：

- SQL 查询能力更强
- 更适合后期扩展与数据分析

适合：

- 对数据结构化要求更高
- 有更多统计、筛选、管理需求

### 存储切换

系统支持 **KV 与 D1 之间同步后切换**。  
切换时会自动迁移数据，减少手动操作成本。

### SQL 导出 / 导入

系统支持将当前机器人数据导出为 SQL，也支持再将 SQL 导回 **KV** 或 **D1**。  
这意味着即使当前使用的是 KV，也可以通过统一的 SQL 文本完成备份、迁移与恢复。

---

## 🖥️ WebUI 页面说明

### 仪表盘

展示系统整体状态：

- 总用户数
- 封禁人数
- 总消息数
- 今日消息数
- 最近对话
- 配置状态

### 对话记录

- 查看用户历史消息
- 搜索用户
- 删除会话
- 关闭对应话题
- 前端已做相邻重复消息去重显示

### 用户管理

- 用户列表分页展示
- 批量操作
- 查看用户详情
- 复制 UID / 姓名
- 加白名单 / 解封 / 封禁
- 快速跳转消息页

### 白名单

- 手动添加用户到白名单
- 查看原因与添加时间
- 移除白名单

### 系统设置

- 所有 Bot 和风控配置集中管理
- 管理员 ID 卡片式展示
- Webhook 与验证码站点地址保持显示
- 支持 SQL 导出 / 导入
- 支持清理数据
- 支持液态玻璃视觉效果开关

### 个人设置

- 修改用户名
- 修改密码
- 启用 / 禁用 2FA
- 2FA 验证与找回密码

---

## 🌐 国际化说明

项目包含前后端共享语言资源，当前支持：

- 简体中文
- 繁體中文
- English

文案文件位于：

```text
shared/locales/
src/locales/
```

其中：

- `shared/locales` 主要用于前后端共享内容
- `src/locales` 用于前端界面文本

---

## 🛠️ 本地开发与预览

> 本项目的完整能力依赖 Cloudflare Pages Functions、KV、D1 等环境，因此本地更适合做前端界面预览或静态构建验证。

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 本地预览构建结果

```bash
npm run preview
```

如果你只是临时本地查看前端页面，也可以自行使用 Vite 本地服务，例如：

```bash
npx vite
```

> 注意：本地直接跑前端时，`/api/*` 与 `/webhook` 等后端能力不会完整可用，需在 Cloudflare 环境中验证。

---

## 📜 项目脚本

`package.json` 中当前可用脚本：

```json
{
  "build": "vite build",
  "preview": "vite preview"
}
```

### 说明

- `npm run build`：构建前端
- `npm run preview`：预览构建后的站点

---

## 🩺 故障排除

<details>
<summary>点击展开查看常见问题</summary>

### 1. 打开 WebUI 返回 500 或白屏

请优先检查：

- 是否已绑定 `KV`
- 变量名是否为大写 `KV`
- 是否完成重新部署

### 2. 设置 Webhook 失败

请检查：

- Bot Token 是否正确
- Webhook URL 是否为公网 HTTPS 地址
- 地址格式是否为：

```text
https://你的域名/webhook
```

### 3. 用户消息没有出现在话题群组

请检查：

- 话题群组（超级群组）是否开启“话题”
- Bot 是否已加入该群组
- Bot 是否拥有创建/管理话题权限
- `FORUM_GROUP_ID` 是否正确（超级群组一般以 `-100` 开头）

### 4. 找不到用户头像或管理员资料

这通常是因为：

- 该用户尚未与 Bot 交互
- 无法从本地用户表中搜索到对应记录
- Telegram 侧用户资料不可直接获取完整信息

系统会自动回退显示为：

- 首字母头像
- 用户名或 ID

### 5. 忘记了 WebUI 密码怎么办？

- 如果账号启用了 2FA，可通过登录页“找回密码”重置
- 如果没有启用 2FA，则需要手动处理存储中的 Web 用户数据

### 6. 清空数据库会删除登录账号吗？

不会。  
系统的“清空数据库”功能只会清空机器人产生的数据，例如：

- 用户
- 消息
- 白名单
- 验证状态
- 会话数据等

**WebUI 登录账号和 2FA 信息会保留。**

### 7. 免费套餐够用吗？

对于轻量到中等规模的 Bot，一般足够。  
具体仍需根据你的消息量、图片验证码使用频率和 API 调用频率评估。

</details>

---

## 🛡️ 安全说明

- Webhook 使用 `X-Telegram-Bot-Api-Secret-Token` 进行校验
- WebUI 密码以 hash 方式存储，不保存明文
- 登录会话使用 Token 机制管理
- 支持 2FA（TOTP）
- 可在登录页使用验证码方式登录
- 支持管理员与用户消息映射，降低串话风险
- 支持消息去重，减少重复发送问题
- 支持清除旧 Webhook，减少切换 Bot Token 后的重复更新风险

---

## 🔄 更新项目

如果你是通过 GitHub Fork 部署的，推荐使用以下方式更新：

### 方式 1：同步上游仓库

将你自己的仓库与上游项目同步，然后让 Pages 自动重新部署。

### 方式 2：手动合并

如果你有自己修改过的代码，建议：

1. 先提交本地改动
2. 拉取上游更新
3. 手动解决冲突
4. 重新部署

---

## 📄 License

本项目仓库内已包含 `LICENSE` 文件，请以仓库根目录中的授权文件为准。

---

## 🙌 致谢

感谢以下技术与平台支持：

- Cloudflare Pages / Pages Functions
- Cloudflare KV / D1
- Vue 3 / Vite / Pinia / Vue Router
- Telegram Bot API

---

<p align="center">
  ⭐ 如果这个项目对你有帮助，欢迎点一个 Star
</p>
