# 贡献指南 · Contributing

本文是**唯一的贡献入口**。所有提交与 PR 都按本文走；模板文件在 `.github/`，流程细则在 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

- 英文版：[CONTRIBUTING_EN.md](CONTRIBUTING_EN.md)
- 功能与部署说明：[README.md](README.md) / [README_EN.md](README_EN.md)
- AI 编码助手规则：[AGENTS.md](AGENTS.md)

---

## 0. 三条硬规则

1. **一个 PR 只做一件事。** 修 bug 不夹带重构，加功能不夹带格式化，文档/模板/CI 变更单独成一个 PR。
2. **不提交未验证的改动。** PR 描述里必须有真实执行过的命令与输出摘要，CI 必须是绿的。
3. **不混入密钥与数据。** `.env`、`data/*.db`、`dist/`、`node_modules/`、Bot Token、Cookie、用户隐私一律不入库。

---

## 1. 准备环境

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
npm ci
cp .env.example .env          # 按需修改，.env 已被 .gitignore 忽略
bash scripts/install-git-hooks.sh   # 启用提交模板 (.gitmessage) + 提交信息校验钩子
npm run server                # http://localhost:3000 ，健康检查 /healthz
```

运行要求：Node.js **22**（与 CI 和 Docker 镜像一致）、npm。

常用脚本（来自 `package.json`，无测试脚本）：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | Vite 构建前端到 `dist/` |
| `npm run lint` | ESLint 检查 `src/ functions/ server/ scripts/ shared/` |
| `npm run lint:fix` | 自动修复可修复项 |
| `npm run server` | 启动 Node 桥接层（生产入口） |
| `npm run server:dev` | `--watch` 热重启 |
| `npm run stop` | 停止本地服务 |
| `npm run admin -- list` | 管理员恢复 CLI（列账号 / 重置密码） |

---

## 2. 分支命名

分支从最新 `main` 拉出，格式 `<type>/<短横线描述>`：

```
feat/topic-archive        fix/d1-pagination-overflow
docs/agent-guide          chore/issue-templates
refactor/db-routing       perf/conversation-cache
ci/pr-size-labeler        hotfix/login-500
```

- 不使用个人姓名或日期前缀，不建长期存在的 `develop`。
- `hotfix/*` 仅用于线上故障，合并后立即回合并到 `main`。
- 禁止对自己的分支以外强推；需要改写历史时只允许 `git push --force-with-lease origin <自己的分支>`。

---

## 3. 提交信息

提交模板见 [`.gitmessage`](.gitmessage)，本地校验钩子见 `.githooks/commit-msg`（`bash scripts/install-git-hooks.sh` 安装）。格式为 **Conventional Commits**：

```
<type>(<scope>): <50 字以内的祈使句说明>

为什么做这个改动：问题现象 / 触发场景 / 收益。
若为缺陷：根因 → 修复方式 → 影响面。

关联：Closes #123
验证：npm run lint；npm run build；手动步骤
```

- `type`：`feat` `fix` `docs` `chore` `refactor` `perf` `style` `ci` `build` `revert`
- `scope`（按本仓库实际目录）：`web` `api` `bot` `auth` `db` `server` `shared` `verify` `i18n` `docker` `ci` `docs` `deps`
- 破坏性变更：`feat(api)!: ...`，正文加 `BREAKING CHANGE: 旧行为 → 新行为`
- 一个提交只做一件事；同一 PR 内不强制 squash，但每个提交都应是可理解的独立步骤。

---

## 4. 提 PR

1. 推分支后按 [PR 模板](.github/pull_request_template.md) 填写，标题同提交规范：`fix(api): 修复 D1 后端会话分页越界`。
2. 描述必须自包含：动机（引用 issue）、改动范围（按层列文件）、**验证证据**（命令 + 输出摘要 + 截图）、风险与回滚方式。
3. PR 只允许改与本主题相关的文件。发现顺手要改的地方 → 另开 issue 或另开 PR。
4. 保持 PR 小而聚焦：经验阈值 **≤ 400 行有效改动、≤ 15 个文件**；超过就在描述里说明为什么不可拆（自动检查见 `.github/workflows/pr-hygiene.yml`）。
5. CI 门禁：`CI Quality Gate`（lint + build）必须通过；`Docker Build & Publish` 在 PR 上只做构建校验，不推镜像。
6. 至少 1 名 CODEOWNERS 审查通过后由维护者 squash 或 merge；合并后删除分支。

### 什么必须拆成独立 PR

| 场景 | 处理 |
| --- | --- |
| 功能 + 顺带修的 bug | 两个 PR，bug 先合 |
| 重构 + 行为变更 | 两个 PR，重构先合且行为不变 |
| `.github/` 模板、CODEOWNERS、Actions 变更 | 独立 `chore(ci)` / `docs` PR，**绝不与功能 PR 混合** |
| 依赖升级 | 独立 `chore(deps)` PR，附构建与启动验证 |
| 大范围格式化 | 独立 PR，且只含格式化 |

---

## 5. 本地验证清单

每个 PR 合并前需自己跑通（CI 只覆盖 lint + build，其余需人工）：

```bash
npm run lint                 # 0 error（warn 需说明）
npm run build                # dist/ 产出正常
npm run server &             # 启动
curl -fsS http://localhost:3000/healthz   # 健康检查
npm run stop
```

按改动面额外验证：

- **存储层**（`db-*.js`）：`ACTIVE_DB=kv`、`d1`、`hyperdrive` 至少各验证一次受影响接口。
- **Bot 相关**（`functions/webhook.js`、`bot-*`）：用测试 Bot 走一遍「私聊 → 建话题 → 管理员回复 → 回传」。
- **认证 / 2FA**：登录、登出、会话过期、TOTP 绑定与恢复码。
- **API 变更**：同步 `openapi.yaml`，并用 `/api-docs` 或 Swagger UI 核对。
- **UI 变更**：附前后对比截图；同时检查中文与英文文案（`shared/locales`、`src/locales`）。
- **部署变更**：`docker compose up -d --build` 后验证 `/healthz`；Cloudflare Pages 侧说明是否需新增绑定或环境变量。

---

## 6. 文档同步

| 改了什么 | 必须同步 |
| --- | --- |
| 新增/变更环境变量 | `.env.example`、`docker-compose.yml`、README 配置章节 |
| 新增/变更 API | `openapi.yaml`、`docs/API.md`（如涉及） |
| 新增用户可见功能 | `README.md` **与** `README_EN.md`（两份结构保持一致） |
| 贡献流程变化 | `CONTRIBUTING.md`、`CONTRIBUTING_EN.md`、`docs/GITHUB_WORKFLOW.md` |
| 目录/分层变化 | `AGENTS.md` 的模块路由表、`docs/ARCHITECTURE.md` |

---

## 7. Issue

- Bug 与功能建议通过 `.github/ISSUE_TEMPLATE/` 表单提交，空白 issue 已关闭。
- 使用与部署问题请到 Discussions，不进 issue 区。
- 安全漏洞不要公开提交，见 [`docs/SECURITY_REPORTING.md`](docs/SECURITY_REPORTING.md)。

---

## 8. 许可

提交即表示同意以仓库的 [MIT License](LICENSE) 发布你的贡献。
