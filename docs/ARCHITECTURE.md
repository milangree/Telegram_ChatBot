# 架构说明 · Architecture

> 依据仓库实际代码整理（`server/index.js`、`functions/api/[[path]].js`、`functions/_shared/db*.js`）。
> 结构变化时同步本文件与 [`../AGENTS.md`](../AGENTS.md) 模块路由表。

---

## 1. 一句话架构

**一套业务代码，两种运行时**：Cloudflare Pages（Workers）直连 KV/D1/Hyperdrive；Docker/Node 用 Express 把 HTTP 请求适配成 Workers 风格再复用同一份 `functions/` 代码。

```
                    ┌──────────────────────────────┐
   Telegram 服务器 ─┤ POST /webhook (secret 校验)   │
                    └──────────────┬───────────────┘
                                   │
    浏览器（Vue3 管理后台 SPA）      │
         │  /api/*  /api-docs      │
         ▼                         ▼
┌───────────────────────────────────────────────────────┐
│  functions/  （Workers 运行时；被两种部署共用）         │
│                                                       │
│  api/[[path]].js  ── 分发器：CORS / CSRF / 会话 / 路由 │
│    └── api/routes/{auth,users,conversations,          │
│                    settings,whitelist,tg,profile}.js  │
│  webhook.js       ── Bot 入口                          │
│    └── _shared/bot.js → bot-thread / bot-keyboard /   │
│        bot-verify / bot-filter / bot-admin / bot-i18n │
│                                                       │
│  _shared/ 基础设施：                                  │
│    auth · totp · audit-log · cors · captcha ·         │
│    error-handler · op-lock · api-utils · tg ·         │
│    db · db-routing · db-settings ·                    │
│    db-kv · db-d1 · db-hyperdrive · db-sql             │
└───────────────────┬───────────────────────────────────┘
                    │  统一入口 new DB(kv, d1, hyperdrive)
        ┌───────────┼──────────────┬──────────────────┐
        ▼           ▼              ▼                  ▼
   Cloudflare KV  D1(SQLite)  Hyperdrive(PG/MySQL)  LocalKV/SQLite
        ▲           ▲              ▲                  ▲
        └───────────┴──────────────┴──────────────────┘
                    ▲
        server/index.js（Express 适配层 + /healthz + /api-docs）
        server/bindings/{kv,d1}.js（本地实现，KV 支持加密 SQLite）
```

---

## 2. 分层与职责

| 层 | 目录 | 职责 | 不该做的事 |
| --- | --- | --- | --- |
| 视图层 | `src/views`、`src/components` | 渲染与交互 | 不直接 `fetch`，不写业务规则 |
| 状态层 | `src/stores` | Pinia store、请求封装、WebSocket | 不拼 HTML、不管路由 |
| 路由层 | `src/router` | 前端路由与守卫 | 不作为安全边界 |
| API 层 | `functions/api` | 路由分发、鉴权、参数校验、响应格式 | 不写存储细节 |
| Bot 层 | `functions/webhook.js`、`_shared/bot-*.js` | 更新处理、话题、键盘、验证流程 | 不直接操作数据库实现 |
| 领域/基础设施 | `functions/_shared/*` | 认证、审计、CORS、限流锁、存储抽象 | 不依赖具体页面 |
| 适配层 | `server/` | 把 HTTP 请求转成 Workers 风格调用 | 不承载业务逻辑 |
| 共享层 | `shared/` | i18n、消息过滤、显示名等纯函数 | 不引入平台 API |

---

## 3. 请求链路

### 3.1 管理后台 API

```
浏览器 → /api/<path>
  → functions/api/[[path]].js#onRequest
      · OPTIONS → 204
      · env.KV 未绑定 → 500
      · checkRequestOrigin（CSRF 基础防护，失败 403）
      · extractToken + getSession（Cookie 会话）
      · 分发到 routes/* 处理器
  → applyCorsToResponse（按请求 Origin 追加白名单头）
```

Node 形态下同一份 `[[path]].js` 由 `server/index.js` 通过请求适配调用；`/api-docs` 与 `/openapi.yaml` 由 Express 直接提供（Swagger UI）。

### 3.2 Telegram Webhook

```
POST /webhook
  · X-Telegram-Bot-Api-Secret-Token 与设置项 WEBHOOK_SECRET 常量时间比较
  · db.autoRepair() → ensureAdminInitializedOnce()
  · processUpdate(update, ctx) 异步执行（waitUntil 或任务跟踪）
  · 立即返回文本 200
```

要点：Webhook 必须快速返回；耗时逻辑（Telegram 调用、存储写入）放到后台任务，失败由 `error-handler.js` 记录。

### 3.3 Bot 消息流

```
用户私聊 → processUpdate → 验证流程（bot-verify）
   ├ 未验证：发验证挑战（math / 图片 / Turnstile / reCAPTCHA / hCaptcha）
   └ 已验证：getOrCreateThread 建话题 → 转发用户消息到话题
管理员在话题回复 → bot-admin 判定 → 回传用户 + 记录会话
```

---

## 4. 存储抽象

```js
import { DB } from './_shared/db.js'
const db = new DB(env.KV, env.D1 || null, env.HYPERDRIVE || null)
```

- `db-routing.js#resolveActiveDb` 决定实际后端：Hyperdrive 标记 → D1 标记 → KV 标记 → 默认 `kv`。
- `db-settings.js#DEFAULT_SETTINGS` 是配置项的唯一默认值来源（如 `VERIFICATION_ENABLED`、`CAPTCHA_TYPE`、`ACTIVE_DB`、`LOGIN_SESSION_TTL`）。
- `db-sql.js` 提供 SQL 后端共用实现，`db-d1.js` 与 `db-hyperdrive.js` 在方言细节上分支。
- 本地形态：`server/bindings/kv.js` 用内存 + SQLite（可选加密），`server/bindings/d1.js` 用 `better-sqlite3`。

**规则**：新增字段/查询必须在三种后端上都语义一致；只改一个后端视为未完成（审查会按 🔴 处理）。

---

## 5. 跨运行时的注意事项

| 话题 | 约束 |
| --- | --- |
| 全局对象 | Workers 无 `fs`/`path`；`crypto` 由 `server/index.js` 用 `webcrypto` polyfill |
| 定时器/后台任务 | 用 `waitUntil`（Workers）或任务跟踪，不依赖 `setTimeout` 长驻 |
| 环境变量 | Workers 走 `env` 绑定；Node 走 `process.env`。新增变量两处都要可达 |
| 静态资源 | 前端由 Pages 托管；Node 形态由 Express 服务 `dist/` + `_redirects` 回退 |
| 并发写 | 用 `op-lock.js` 的 `withUserLock` 等原语，不假设单实例 |
| 镜像构建 | `Dockerfile` 在 `$BUILDPLATFORM` 完成前端构建，避免 QEMU 下 Node/esbuild SIGILL |

---

## 6. 安全边界（改动时必看）

- 认证：PBKDF2 密码哈希 + 会话 Cookie（`LOGIN_SESSION_TTL` 控制有效期），可选 TOTP 2FA（`totp.js`），旧哈希可临时兼容（`ALLOW_LEGACY_PASSWORD_HASH`）。
- CSRF：状态变更请求校验 `Origin`/`Referer`（`cors.js#checkRequestOrigin`）。
- CORS：默认同源；`CORS_ORIGIN` 白名单，永不返回 `*`。
- 审计：管理员敏感操作写 `audit-log.js`。
- 人机验证：服务端复核，前端结果不可信。
- Cookie 安全：HTTPS 反代场景需 `COOKIE_SECURE=1`。
- 探测防护：`_redirects` 对常见扫描路径直接 404。

---

## 7. 已知技术债（改动时避免加剧）

| 位置 | 现状 | 建议 |
| --- | --- | --- |
| `src/views/SettingsView.vue` | 近 2000 行，单文件承载全部设置项 | 新增大块设置优先抽子组件 |
| `functions/_shared/bot.js` 等 | 逻辑集中在少数大文件 | 按消息类型或流程拆分模块 |
| `db-*.js` 四种实现 | 语义一致性靠人工保证 | 新增能力先写统一入口方法，再逐后端实现 |
| 无自动化测试 | 只有 lint + build | 改动高风险逻辑时在 PR 里给出可复现的手动验证步骤 |
