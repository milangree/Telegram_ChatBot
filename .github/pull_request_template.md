<!--
PR 标题格式：<type>(<scope>): <一句话改动>
例：fix(api): 修复 D1 后端下会话列表分页越界
规则：一个 PR 只做一件事。混合改动请拆分为独立 PR（见 docs/GITHUB_WORKFLOW.md）。
提交前请先在本地跑通：npm run lint && npm run build
-->

## 1. 动机（Why）

<!-- 这个改动解决什么问题？引用 issue / 需求原文 / 复现路径。没有关联 issue 也要写清触发场景。 -->

- 关联 issue：Closes #
- 问题现象 / 需求：
- 不修会怎样：

## 2. 改动范围（What）

<!-- 按层勾选，并列出关键文件。跨层改动说明为什么无法拆开。 -->

| 层 | 涉及 |
| --- | --- |
| 前端 `src/` | |
| 函数层 `functions/` | |
| 存储层 `db-*.js` | |
| Node 桥接 `server/` | |
| 共享模块 `shared/` | |
| 构建 / 部署 | |

- 关键文件与说明：
- 明确不在本 PR 内的内容：

## 3. 验证证据（Evidence）

> 贴真实命令与输出摘要，不接受“本地测试通过”这类无证据表述。

```bash
npm run lint      # 结果：
npm run build     # 结果：
```

| 验证项 | 命令 / 操作 | 结果 |
| --- | --- | --- |
| 前端构建 | `npm run build` | |
| 本地启动 | `npm run server`（默认 `http://localhost:3000`，健康检查 `/healthz`） | |
| 存储后端 | `ACTIVE_DB=kv` / `d1` / `hyperdrive` 各自的实测结果 | |
| 部署形态 | Cloudflare Pages / Docker（未测请注明） | |
| 回归点 | 受影响的既有功能 | |

截图 / 录屏（拖入本 PR 即可，或注明 `docs/assets/...` 路径）：

## 4. 风险与回滚（Risk & Rollback）

- 风险等级：低 / 中 / 高
- 可能的副作用（含数据迁移、环境变量新增、兼容性）：
- 回滚方式：`git revert <sha>` 即可 / 需要额外操作（写清步骤）
- 是否涉及数据结构或密钥变化（是则说明迁移与老数据兼容策略）：

## 5. 提交前自检

- [ ] 一个 PR 只做一件事，未夹带无关格式化或无关注释
- [ ] 提交信息符合 `.gitmessage`（`type(scope): 说明`），正文写了「为什么」
- [ ] `npm run lint` 通过（0 error）
- [ ] `npm run build` 通过，`dist/` 可正常加载
- [ ] 未提交 `.env`、密钥、`data/*.db`、`dist/`、`node_modules/`
- [ ] 新增环境变量已同步 `.env.example`、`docker-compose.yml`、README
- [ ] 新增/变更 API 已同步 `openapi.yaml`
- [ ] 涉及 UI 的改动带截图；涉及 i18n 的同时更新中英文案
- [ ] 文档已同步（`docs/`、README / README_EN 双份）
- [ ] 破坏性变更已在标题加 `!` 并在正文标注 `BREAKING CHANGE:`

## 6. 审查者关注点（可选）

<!-- 希望审查者重点看哪里、哪里有疑问、哪些是已知取舍。 -->
