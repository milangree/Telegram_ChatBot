# PR 审查标准 · Review Guidelines

> 适用仓库：[milangree/Telegram_ChatBot](https://github.com/milangree/Telegram_ChatBot)
> 配套文件：`.github/pull_request_template.md`、`.github/CODEOWNERS`、[`docs/GITHUB_WORKFLOW.md`](../docs/GITHUB_WORKFLOW.md)

审查只有两个问题：**这个 PR 是否只做一件事**，以及**证据是否支持它做成了**。风格偏好排在最后，且不得阻塞合并。

---

## 1. 分级标记

审查意见一律带级别，作者据此判断是否阻塞：

| 标记 | 含义 | 合并影响 |
| --- | --- | --- |
| 🔴 阻塞 | 正确性、安全性、数据兼容性、范围越界问题 | 必须修复后才能合并 |
| 🟡 建议 | 可维护性、命名、注释、可拆分的更优写法 | 可合并，建议本次或下个 PR 处理 |
| 💭 讨论 | 设计取舍、需要作者解释 | 不阻塞，但需在 PR 里留下结论 |

不带标记的意见视为噪音；"nit:" 前缀的意见一律不阻塞。

---

## 2. 唯一拆分标准：一个 PR 只做一件事

**判定方法**：用一句话描述这个 PR，如果必须出现"并且"或"顺便"，就已经越界。

```
✅ fix(db): D1 后端会话列表分页越界
❌ fix(db): 修复分页越界，顺便整理了 db-routing 的命名
❌ feat(web): 新增话题归档；修复登录页样式
```

**逐 hunk 归属**：审查时按文件、按 hunk 把改动划给功能主题。无法归属任何主题的改动，单列 `chore` 或 `fix` PR。

### 本仓库的天然 PR 边界

按实际目录划分，同一主题内的文件应同进同出：

| PR 主题 | 归属文件 |
| --- | --- |
| 前端页面/组件 | `src/views/*`、`src/components/*`、`src/stores/*`、`src/router/*` |
| API 路由 | `functions/api/routes/*`、`functions/api/[[path]].js` |
| Bot 逻辑 | `functions/webhook.js`、`functions/_shared/bot-*.js` |
| 认证与安全 | `functions/_shared/auth.js`、`totp.js`、`audit-log.js`、`cors.js` |
| 验证码/人机验证 | `functions/_shared/captcha.js`、`bot-verify.js` |
| 存储层 | `functions/_shared/db*.js`（跨后端改动必须一起改，属同一 PR） |
| Node 桥接层 | `server/index.js`、`server/bindings/*` |
| 共享模块与多语言 | `shared/*`、`shared/locales/*`、`src/locales/*` |
| 构建与部署 | `Dockerfile`、`docker-compose.yml`、`vite.config.js`、`_redirects` |
| 仓库治理 | `.github/**`、`.gitmessage`、`CONTRIBUTING*.md`、`AGENTS.md`、`docs/**` |

**跨层例外**：一个功能天然横跨多层（如"新增字段"需同时改 `db-*.js` + 路由 + 视图 + `openapi.yaml`），允许在一个 PR 内完成，但必须在 PR 描述的「改动范围」中说明**为什么不可拆**，并保证没有夹带无关文件。

---

## 3. 阻塞项清单（🔴）

### 正确性

- [ ] 改动在 `ACTIVE_DB=kv` / `d1` / `hyperdrive` 下不产生未处理的分支差异（涉及存储层时）
- [ ] 错误路径有处理：`try/catch` 不吞异常、`await` 未遗漏、`Promise` 拒绝有 `Error` 对象（ESLint `prefer-promise-reject-errors` / `no-throw-literal` 为 error 级）
- [ ] 并发/幂等：写操作在 `op-lock.js` 保护范围内，重复提交不会产生重复记录
- [ ] 鉴权：新增 API 走统一鉴权，不出现只靠前端隐藏的"管理员功能"
- [ ] 输入校验：来自 Telegram 或 HTTP 的字段在使用前校验类型与长度

### 安全

- [ ] 无硬编码密钥、Bot Token、Cookie、密码；日志不打印敏感值
- [ ] 新增 CORS 行为经 `corsHeadersFor`，未放开成 `*`
- [ ] 用户输入拼接进 SQL 时使用参数化；拼接进 HTML 时转义
- [ ] 审计相关操作写入 `audit-log.js`（管理员变更、越权尝试）

### 数据与兼容

- [ ] 涉及存储结构变化时说明老数据兼容策略与迁移步骤
- [ ] 环境变量新增/改名已同步 `.env.example`、`docker-compose.yml`、README
- [ ] 破坏性变更在标题加 `!`，正文写 `BREAKING CHANGE: 旧 → 新`

### 范围与卫生

- [ ] PR 只做一件事，无无关格式化、无顺手重构、无调试残留（`console.log` 调试输出、注释掉的代码块）
- [ ] 未提交 `dist/`、`data/*.db`、`.env`、`node_modules/`
- [ ] PR 描述包含真实执行过的验证命令与输出摘要

---

## 4. 建议项清单（🟡）

- [ ] 命名与既有约定一致：`functions/_shared` 用 `bot-` 前缀、存储用 `db-` 前缀、Vue 组件用 `PascalCase.vue`
- [ ] 前端文案走 i18n，不硬编码中文字符串；新增 key 在中英文 locale 里成对出现
- [ ] 注释解释"为什么"，不复述代码；导出函数有简短用途说明（本仓库注释风格为中文）
- [ ] 复杂分支可拆分；单文件超 500 行时说明是否应拆模块（现状：`SettingsView.vue` 已接近 2000 行，新增大块逻辑优先抽组件）
- [ ] 与 `openapi.yaml` 保持同步，接口描述与真实响应一致
- [ ] 提交信息逐个符合 `.gitmessage`；一个 PR 内的提交序列可读

---

## 5. 审查节奏

1. **先看描述**：动机与范围能否对上 diff；对不上直接 🔴 退回补描述。
2. **再看 diff 结构**：文件清单是否符合上表的 PR 边界；越界即 🔴 要求拆分。
3. **后看实现**：按第 3、4 节清单逐项过；只在真实风险处留意见。
4. **最后看证据**：命令与输出是否足以支撑"改完了"。缺证据 → 🔴 要求补跑。

审查意见要求：**指出位置（文件:行）+ 说清影响 + 给出可执行的最小修复**。禁止只写"这里有问题"。

---

## 6. 合并条件

- `CI Quality Gate`（lint + build）绿
- `PR Hygiene`（文件数/行数/占位符检查）通过或已说明豁免
- 至少 1 名 CODEOWNERS 批准
- 所有 🔴 已解决；🟡 与 💭 已回复（接受或转 issue）
- 分支基于最新 `main`，无冲突
- 合并后删除分支；功能 PR 用 squash 或 merge 由维护者决定，**不做无意义 squash 历史重写**
