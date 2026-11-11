# Copilot 指令 · 项目上下文

本仓库：Telegram 双向消息机器人（Vue 3 管理后台 + Cloudflare Workers Functions + Node/Express 桥接层），业务代码在 `functions/` 与 `shared/` 中由两种运行形态共用。完整规则见 `AGENTS.md`。

## 生成代码时必须遵守

- 存储访问只走 `functions/_shared/db.js` 的统一入口；改动存储行为要同时覆盖 `db-kv.js`、`db-d1.js`、`db-hyperdrive.js` 与 `db-sql.js`。只改一个后端视为不完整。
- `functions/**` 与 `shared/**` 的代码必须同时兼容 Cloudflare Workers 与 Node 22，不引入 `fs`/`path`/`process.on` 等平台专有用法到共享路径（`server/bindings/` 与 `server/index.js` 例外）。
- 鉴权统一用 `functions/_shared/auth.js` 的会话与 `isWebAdmin` 判断；跨站响应统一经 `corsHeadersFor` / `applyCorsToResponse`，不要手写 `Access-Control-Allow-Origin: *`。
- 所有面向用户的文案走 i18n：`shared/locales/{zh-hans,zh-hant,en}.js` 与 `src/locales/*`，三语同时补齐，不硬编码中文/英文句子。
- 错误处理用 `functions/_shared/error-handler.js` 的 `logError` / `silentCatch`，不要空 `catch {}` 吞异常；`Promise` 拒绝必须传 `Error`（ESLint `prefer-promise-reject-errors`、`no-throw-literal` 为 error 级）。
- 注释用中文，解释"为什么"而不是复述代码；文件首行写相对路径注释，与现有风格一致。
- 新增配置项：先加进 `functions/_shared/db-settings.js` 的 `DEFAULT_SETTINGS`，再改管理后台，再同步 `.env.example`、`docker-compose.yml`、README 双份。
- 新增/变更 HTTP API：在 `functions/api/routes/` 加处理函数，在 `functions/api/[[path]].js` 注册，并同步 `openapi.yaml`。
- 前端调用后端只用 `src/stores/api.js`，不要在组件里直接 `fetch`。

## 不要做的事

- 不要写测试文件、不要加 `vitest`/`jest`、不要新增 `test` 脚本——本仓库已移除测试基础设施，CI 只跑 lint + build。
- 不要改 Node 版本基线（22），不要动 `Dockerfile` 里 `--platform=$BUILDPLATFORM` 的构建阶段设定。
- 不要在补全中引入新依赖；需要时先说明理由。
- 不要生成 `.env`、密钥、`data/*.db` 相关内容。

## 验证命令

```bash
npm run lint
npm run build
npm run server    # :3000，健康检查 /healthz，API 文档 /api-docs
```
