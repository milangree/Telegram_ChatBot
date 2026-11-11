# AGENTS.md · AI 编码助手规则

> 本文件面向所有在仓库内工作的 AI 编码助手（Claude Code、Codex、Cursor、Copilot、Cline、Aider 等）。
> 人类贡献者请看 [`CONTRIBUTING.md`](CONTRIBUTING.md)，流程规则见 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。
> 与本文冲突的通用默认行为，以本文为准。

---

## 0. 铁律（违反即视为任务失败）

1. **一个 PR 只做一件事。** 需要改两个主题 → 两个分支、两个 PR、两条独立描述。
2. **仓库治理文件单独成 PR。** `.github/**`、`.gitmessage`、`CONTRIBUTING*`、`AGENTS.md`、`docs/**` 不得与源码改动混在同一 PR。
3. **不许编造执行结果。** 未真正运行的命令不写进 PR 描述；测试/构建结果必须是真实输出。
4. **不许提交**：`.env`、`data/*.db*`、`dist/`、`node_modules/`、`.server.pid`、Bot Token、webhook secret、Cookie、真实用户数据。
5. **不许把测试框架塞回来。** 本仓库已移除 `tests/` 与 vitest，`package.json` 无 `test` 脚本，CI 只做 lint + build。需要测试基础设施请先开 issue。
6. **不许改 Node 基线。** 本地、CI（`ci.yml`）、镜像（`Dockerfile`）统一 Node 22。
7. **不许强推共享分支。** 只允许 `git push --force-with-lease` 到自己的功能分支。
8. **不许顺手格式化全仓。** 大范围格式化必须独立 PR。

---

## 1. 项目是什么

Telegram 双向消息机器人：用户私聊 Bot → 自动在论坛群建话题 → 管理员在话题里回复 → 消息回传用户；附带 Vue 3 管理后台。

同一套业务代码运行在两种形态：

```
Cloudflare Pages ── functions/ (Workers 运行时) ── KV / D1 / Hyperdrive
Docker / Node    ── server/index.js (Express 桥接) ── 复用同一份 functions/ 代码
```

**这是本仓库最容易踩坑的地方**：`functions/` 下的代码必须同时能在 Workers 与 Node 下跑通。改动时不要引入 Node 专有 API（`fs`、`path`、`process` 之外）或 Workers 专有 API 到共享代码里；需要平台差异时按现有模式在 `server/bindings/` 与 `functions/_shared/db-*.js` 里分支。

---

## 2. 模块路由表（改什么去哪个目录）

| 需求 | 目录 / 文件 | 注意 |
| --- | --- | --- |
| 管理后台页面 | `src/views/*.vue`、`src/components/*.vue` | 文案走 i18n，不硬编码中文 |
| 前端状态 | `src/stores/*.js`（Pinia） | `api.js` 统一请求，`websocket.js` 实时更新 |
| 前端路由 | `src/router/` | SPA，`_redirects` 负责回退 |
| HTTP API | `functions/api/[[path]].js`（分发器）+ `functions/api/routes/*.js` | 新增路由在分发器注册，同步 `openapi.yaml` |
| Bot 消息处理 | `functions/webhook.js` → `functions/_shared/bot.js` | webhook secret 校验不可绕过 |
| 话题 / 键盘 / 消息卡片 | `bot-thread.js`、`bot-keyboard.js` | 涉及 Telegram API 调用 |
| 验证码与人机验证 | `bot-verify.js`、`captcha.js` | 服务端必须复核，不能只信前端 |
| 鉴权 / 2FA / 审计 | `auth.js`、`totp.js`、`audit-log.js` | 改这些需 CODEOWNERS 审查 |
| 跨站与来源 | `cors.js` | 默认同源，禁止放开 `*` |
| 存储抽象 | `db.js`（统一入口）、`db-kv.js`、`db-d1.js`、`db-hyperdrive.js`、`db-sql.js`、`db-routing.js`、`db-settings.js` | 跨后端改动必须一起改，禁止只改一个后端 |
| 默认配置项 | `db-settings.js` 的 `DEFAULT_SETTINGS` | 新增配置要同步 `.env.example` 与 README |
| Node 桥接 | `server/index.js`、`server/bindings/{kv,d1}.js` | Express 适配层，别在这里写业务 |
| 共享工具与多语言 | `shared/*.js`、`shared/locales/{zh-hans,zh-hant,en}.js` | 三语齐全，前端 `src/locales/` 同步 |
| 运维 CLI | `scripts/admin-recovery.js` | 输出不得含明文密码/密钥 |
| 部署 | `Dockerfile`、`docker-compose.yml`、`_redirects`、`vite.config.js` | 构建产物与 CPU 架构无关，注意 `--platform=$BUILDPLATFORM` 的原因 |
| API 契约 | `openapi.yaml`（Swagger UI 在 `/api-docs`） | 与真实响应保持一致 |

---

## 3. 命令（唯一可信来源）

```bash
npm ci                    # 安装（CI 同款）
npm run lint              # ESLint：src/ functions/ server/ scripts/ shared/
npm run lint:fix          # 自动修复
npm run build             # Vite → dist/
npm run server            # 生产入口（Express，默认 :3000，健康检查 /healthz）
npm run server:dev        # node --watch 热重启
npm run stop              # 停止本地服务
npm run admin -- list     # 管理员 CLI：列账号
npm run admin -- reset-password
```

- 没有 `npm test`。不要发明脚本，不要新增依赖来解决"想跑测试"的冲动。
- 环境变量从 `.env.example` 复制；可用 `ACTIVE_DB=kv|d1|hyperdrive` 切换后端。
- API 文档：启动后访问 `http://localhost:3000/api-docs`。

---

## 4. 改动前的自检流程

```
1. 读懂现有实现（先读，后写；不要凭文件名猜行为）
2. 判定主题数量 → 若 >1，先拆分支
3. 找出该主题的完整文件集（见第 2 节路由表）
4. 检查是否跨后端/跨运行形态 → 一并处理
5. 写代码，保持既有注释风格（中文说明"为什么"）
6. 跑 npm run lint && npm run build，真实记录输出
7. 需要时启动服务验证 /healthz 与受影响接口
8. 按模板写 PR 描述（含证据）
```

**禁止行为**：为了让 lint 通过而改 ESLint 配置（除非 PR 主题就是 lint 规则调整）；为了让构建通过而注释掉功能；把失败测试标记 skip（本仓库无测试，但同理不适用）。

---

## 5. 提交与 PR

提交信息（详见 [`.gitmessage`](.gitmessage)；本地钩子 `.githooks/commit-msg` 会拦下不合规首行，安装：`bash scripts/install-git-hooks.sh`）：

```
<type>(<scope>): ≤50 字说明

为什么：现象 / 场景 / 收益
修复思路（缺陷）：根因 → 改法 → 影响面

关联：Closes #123
验证：npm run lint；npm run build；（手动步骤）
```

`type`：`feat` `fix` `docs` `chore` `refactor` `perf` `style` `ci` `build` `revert`
`scope`：`web` `api` `bot` `auth` `db` `server` `shared` `verify` `i18n` `docker` `ci` `docs` `deps`

分支：`<type>/<短横线描述>`，从最新 `main` 拉出，例：`fix/d1-pagination-overflow`。

PR 描述必填六节：动机 / 改动范围 / 验证证据 / 风险与回滚 / 自检清单 / 审查关注点。模板见 [`.github/pull_request_template.md`](.github/pull_request_template.md)。

**规模阈值**：≤ 400 行有效改动、≤ 15 个文件（由 `pr-hygiene.yml` 打 size/* 标签并提示）。

---

## 6. AI 助手的额外约束

| 约束 | 说明 |
| --- | --- |
| 不擅自扩大范围 | 用户要求修 A，不要顺手改 B；发现 B 有问题就写进报告或开 issue |
| 不伪造验证 | 没跑过的命令不要贴输出；截断的输出要说明截断位置 |
| 不生成假链接/假文件 | 引用仓库文件前先确认存在（`ls` / 读文件） |
| 不改用户本地配置 | `git config` 只允许 `--local`；不动全局配置 |
| 不绕过校验 | 不用 `git commit --no-verify` 逃避钩子；格式不合规就改信息 |
| 不擅自 commit/push | 除非用户明确要求 |
| 不改 CODEOWNERS 为自己 | 审查归属由维护者决定 |
| 语言 | 与用户当前语言一致；仓库文档中文为主，`*_EN.md` 保持对应 |
| 依赖 | 新增运行时依赖需在 PR 描述说明理由与体积/安全影响，并同步 lock 文件 |
| 安全 | 涉及 `auth/totp/captcha/cors/audit-log` 的改动要在 PR 里显式写出安全影响 |

---

## 7. 常见任务速查

**加一个 API**：`functions/api/routes/<域>.js` 写处理函数 → `functions/api/[[path]].js` 注册 → `openapi.yaml` 补路径 → 前端 `src/stores/api.js` 加调用 → 权限校验走 `isWebAdmin`。

**加一个配置项**：`db-settings.js` 的 `DEFAULT_SETTINGS` → 管理后台 `src/views/SettingsView.vue` → `.env.example` + `docker-compose.yml`（如属启动期变量）→ README 双份。

**加一种验证码**：`captcha.js` 服务端校验 → `bot-verify.js` 流程接入 → `CAPTCHA_TYPE` 枚举 → 三语 locale → README 验证系统表格。

**改存储层**：三个后端 + `db.js` 统一入口 + `db-routing.js` 的 `ACTIVE_DB` 解析一起看；验证时至少跑 `kv` 与 `d1`。

**改构建/镜像**：确认 `Dockerfile` 的 `--platform=$BUILDPLATFORM` 语义（避免 QEMU 下 SIGILL），`server/package.json` 与根 `package.json` 依赖分流不要混。

---

## 8. 交付前最终检查

- [ ] 主题单一，未夹带无关文件
- [ ] 治理文件与源码没有混在同一 PR
- [ ] `npm run lint`、`npm run build` 真实通过并已记录
- [ ] 涉及存储/推送/鉴权的改动已按第 2 节路由表全量覆盖
- [ ] 文档同步：README 双份（如用户可见）、`openapi.yaml`（如 API）、`.env.example`（如配置）
- [ ] 无密钥、无 `dist/`、无 `data/*.db`、无调试残留
- [ ] 提交信息符合 `.gitmessage`，PR 描述含证据
