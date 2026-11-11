# CLAUDE.md

本仓库的完整 AI 助手规则见 [`AGENTS.md`](AGENTS.md)。本文件是 Claude Code 的入口摘要，二者冲突时以 `AGENTS.md` 为准。

## 必读

1. [`AGENTS.md`](AGENTS.md) — 铁律、模块路由表、命令、交付检查
2. [`CONTRIBUTING.md`](CONTRIBUTING.md) — 人类协作流程
3. [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md) — 分支、提交、PR 拆分矩阵
4. [`.github/REVIEW_GUIDELINES.md`](.github/REVIEW_GUIDELINES.md) — 什么会被判定为阻塞

## 最短记忆版

```bash
npm run lint     # 必须通过
npm run build    # 必须通过
npm run server   # 本地 :3000，健康检查 /healthz，API 文档 /api-docs
```

- 一个 PR 只做一件事；`.github/**`、`docs/**`、`CONTRIBUTING*`、`AGENTS.md` 的改动单独成 PR。
- 无测试框架，不要引入 `vitest`/`tests/`，不要加 `npm test`。
- Node 22 固定；不要改 CI 版本基线。
- 不提交 `.env`、`data/*.db*`、`dist/`、`node_modules/`。
- `functions/` 代码要同时跑在 Cloudflare Workers 与 Node 桥接层，别引入平台专有 API。
- 存储层改动必须同时覆盖 `db-kv.js` / `db-d1.js` / `db-hyperdrive.js` + `db.js`。
- 提交格式 `<type>(<scope>): 说明`，scope 取 `web api bot auth db server shared verify i18n docker ci docs deps`。
- 不擅自 commit/push，不改用户全局 git 配置。
