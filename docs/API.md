# API 约定 · API

> 契约文件：[`../openapi.yaml`](../openapi.yaml)（OpenAPI 3.0.3）。本地启动后访问 `http://localhost:3000/api-docs` 查看 Swagger UI。
> 改接口时 `openapi.yaml` 必须同步，否则审查按 🔴 处理。

---

## 1. 基础约定

| 项 | 约定 |
| --- | --- |
| Base path | `/api`（Functions 侧由 `functions/api/[[path]].js` 分发） |
| 本地地址 | `http://localhost:3000/api` |
| 认证 | 登录后服务端下发 `session` Cookie，后续请求自动携带；无 Bearer Token |
| 请求体 | JSON（`Content-Type: application/json`） |
| 响应体 | JSON；错误为 `{ "error": "<本地化消息>" }`，由 `api-utils.js#err` 生成 |
| 本地化 | 按请求语言返回错误文案（`getApiTranslator`） |
| CORS | 默认同源；仅 `CORS_ORIGIN` 白名单返回对应头，永不返回 `*` |
| CSRF | 状态变更请求校验 `Origin`/`Referer`，失败 403 |
| 健康检查 | `GET /healthz`（不在 `/api` 下，由 `server/index.js` 提供） |

状态码约定：

| 码 | 含义 |
| --- | --- |
| 200 | 成功 |
| 204 | 预检 / 无内容 |
| 400 | 参数不合法 |
| 401 | 未登录或会话过期 |
| 403 | 来源校验失败 / 无权限 |
| 404 | 资源不存在 |
| 409 | 冲突（重复、锁竞争） |
| 500 | 服务端错误（KV 未绑定等） |

---

## 2. 路由清单

来源：`openapi.yaml` 与 `functions/api/routes/`。

### auth · `routes/auth.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/auth/status` | 初始化状态（是否已有管理员、是否需要引导） |
| POST | `/auth/login` | 账号密码登录，设置 session Cookie；支持 TOTP |
| POST | `/auth/logout` | 注销并吊销会话 |
| GET | `/auth/me` | 当前登录身份与权限 |

### users · `routes/users.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/users` | 用户列表（分页 `clampPageSize`，附带 `is_whitelisted`） |
| PUT | `/users/{userId}/block` | 拉黑用户 |
| PUT | `/users/{userId}/unblock` | 解除拉黑 |
| DELETE | `/users/{userId}` | 删除用户及其会话数据 |

### conversations · `routes/conversations.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/conversations` | 会话列表 |
| GET | `/conversations/{userId}` | 指定用户的消息记录 |
| POST | `/conversations/{userId}` | 以管理员身份向该用户发送消息 |

### settings · `routes/settings.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/settings` | 读取全部设置（敏感项按约定脱敏） |
| PUT | `/settings` | 更新设置 |
| GET | `/settings/audit-logs` | 审计日志（管理员操作记录） |

### whitelist · `routes/whitelist.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/whitelist` | 白名单列表 |
| POST | `/whitelist/{userId}` | 加入白名单 |
| DELETE | `/whitelist/{userId}` | 移出白名单 |

### tg · `routes/tg.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tg/me` | 校验 Bot Token，返回 Bot 自身信息 |
| POST | `/tg/resolve-chat` | 解析群/话题 ID |

### profile · `routes/profile.js`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| PUT | `/profile/username` | 改用户名（`^[a-zA-Z0-9_]+$`） |
| PUT | `/profile/password` | 改密码（需旧密码校验） |
| POST | `/profile/2fa/setup` | 生成 TOTP secret 与 `otpauth://` 链接 |
| POST | `/profile/2fa/verify` | 校验 TOTP（绑定或登录二次验证） |

> `/profile/*` 是唯一的非管理员可达路径（分发器中 `isProfilePath` 例外），其余接口都要求 `isWebAdmin`。

### 统计 · 分发器内联

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/stats` | 仪表盘统计（`db.getStats()`），需管理员 |

> `/stats` 直接在 `functions/api/[[path]].js` 分发器中实现，没有独立 routes 文件；**它当前未写入 `openapi.yaml`**，属于已知契约缺口，补文档时优先处理。

---

## 3. 新增接口的步骤（顺序不可颠倒）

1. 在 `functions/api/routes/<域>.js` 实现处理函数，复用 `api-utils.js` 的 `j` / `err` / `clampPageSize` / `isWebAdmin`。
2. 在 `functions/api/[[path]].js` 注册路由（分发器是唯一入口）。
3. 需要审计的写操作调用 `audit-log.js#logAuditAction`。
4. 存储访问走 `db.js` 统一入口，跨后端一致（见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 第 4 节）。
5. 更新 `openapi.yaml`：`tags` 归类、`paths` 补全、请求/响应 schema 与真实一致。
6. 前端在 `src/stores/api.js` 增加调用方法，不在组件内直接请求。
7. 本地验证：`npm run server` → `/api-docs` 手动调一次 → 记录到 PR 证据。

---

## 4. `openapi.yaml` 维护规则

- `info.version` 跟随 `package.json` 的 `version`。
- 每个 `paths` 项必须带 `tags`、`summary`、响应 schema；不要把实现细节写进描述。
- 新增状态码要写进 `responses`。
- 中文描述为主，字段名保持英文。
- 变更后自检：

```bash
npm run server &
curl -fsS http://localhost:3000/openapi.yaml -o /dev/null -w '%{http_code}\n'
npm run stop
```
预期输出 `200`。也可用任意 OpenAPI 校验器核对语法。

---

## 5. 示例

```bash
# 登录（保存 Cookie）
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<your-password>"}'

# 带会话调用
curl -s -b cookies.txt http://localhost:3000/api/users?page=1&pageSize=20

# 发送消息给用户
curl -s -b cookies.txt -X POST http://localhost:3000/api/conversations/123456789 \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello from admin"}'
```

实测时把密码、Cookie 换成你自己的值；**不要把 `cookies.txt` 或真实 token 提交到仓库或贴进 issue**。
