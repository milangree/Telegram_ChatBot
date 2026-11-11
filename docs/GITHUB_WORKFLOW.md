# GitHub 工作流手册 · GitHub Workflow

> 本文件是仓库协作流程的**规范事实来源**。模板文件放在 `.github/`，本文解释规则、命令与落地顺序。
> 相关文件：[`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`.github/pull_request_template.md`](../.github/pull_request_template.md) · [`.github/REVIEW_GUIDELINES.md`](../.github/REVIEW_GUIDELINES.md) · [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md) · [`AGENTS.md`](../AGENTS.md)

---

## 1. 资产总览

| 文件 | 作用 | 何时改 |
| --- | --- | --- |
| `.gitmessage` | 提交信息模板 | 新增 type / scope |
| `.githooks/commit-msg` + `scripts/install-git-hooks.sh` | 本地提交信息校验钩子 | 提交规范变化 |
| `.github/pull_request_template.md` | PR 描述模板 | 需要新的证据项 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Bug 表单 | 需要新的环境字段 |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 功能表单 | 模块划分变化 |
| `.github/ISSUE_TEMPLATE/config.yml` | issue 入口（关空白 issue、导流 Discussions） | 社区渠道变化 |
| `.github/CODEOWNERS` | 审查归属 | 目录结构调整 |
| `.github/labels.yml` | 标签唯一事实来源 | 新增标签 |
| `.github/labeler.yml` | 路径 → 标签映射 | 新增目录 |
| `.github/REVIEW_GUIDELINES.md` | 审查标准与分级 | 审查口径变化 |
| `.github/workflows/ci.yml` | 必需门禁：lint + build | 构建方式变化 |
| `.github/workflows/pr-hygiene.yml` | PR 规模/卫生信号 | 阈值调整 |
| `.github/workflows/pr-labeler.yml` | 自动打标签 | 标签规则变化 |
| `.github/workflows/commit-convention.yml` | 提交信息提示 | 约定变化 |
| `CONTRIBUTING.md` / `CONTRIBUTING_EN.md` | 贡献指南 | 流程变化 |
| `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` | AI 助手规则 | 目录或命令变化 |
| `docs/*.md` | 架构、API、安全、发布 | 对应主题变化 |

**治理文件（`.github/**`、`.gitmessage`、`CONTRIBUTING*`、`AGENTS.md`、`docs/**`）的改动必须单独成 PR，不得与源码改动混在一起** —— 这条由 `pr-hygiene.yml` 自动检测并在日志中提示。

---

## 2. 分支模型

```
main ──●──●──●──●──●──●──>   始终可部署；受保护，仅通过 PR 合入
        \      \    \
         feat/…  fix/… chore/…
```

| 分支 | 来源 | 去向 | 命名 |
| --- | --- | --- | --- |
| `main` | — | — | 受保护，禁止直接 push |
| `feat/*` | `main` | `main` | `feat/topic-archive` |
| `fix/*` | `main` | `main` | `fix/d1-pagination-overflow` |
| `chore/*` `docs/*` `ci/*` | `main` | `main` | `chore/issue-templates` |
| `refactor/*` `perf/*` | `main` | `main` | `refactor/db-routing` |
| `hotfix/*` | `main` | `main` | `hotfix/login-500` |

规则：

1. 不设长期 `develop`；不建超过 2 周未合并的分支（超时先 rebase 或关掉）。
2. 每个分支只承载一个主题；主题变了就开新分支。
3. 强推只允许作用于自己的分支：`git push --force-with-lease origin <branch>`。
4. 合并后删除源分支；`hotfix/*` 合并后需确认 `main` 与线上镜像一致。

---

## 3. 提交规范

启用模板与钩子（二合一）：

```bash
bash scripts/install-git-hooks.sh
# 等价于：
#   git config --local commit.template .gitmessage
#   git config --local core.hooksPath .githooks
```

钩子 `commit-msg` 会在本地拦下不合规的提交首行（`update`、`fix bug`、未知 scope 等），提示语给出正确格式；`git commit --no-verify` 可临时绕过。钩子只作用于**本机**，CI 侧的 `commit-convention.yml` 负责在 PR 上给出同样的提示。

格式：

```
<type>(<scope>): <祈使句，≤50 字>

为什么：问题现象 / 触发场景 / 预期收益
修复思路（缺陷类）：根因 → 改法 → 影响面

关联：Closes #123
验证：npm run lint；npm run build；（手动步骤）
风险与回滚：无 / 具体说明
```

- `type`：`feat` `fix` `docs` `chore` `refactor` `perf` `style` `ci` `build` `revert`
- `scope`：`web` `api` `bot` `auth` `db` `server` `shared` `verify` `i18n` `docker` `ci` `docs` `deps`
- 破坏性变更：`feat(api)!: ...` + 正文 `BREAKING CHANGE: 旧行为 → 新行为`
- 一个提交一个意图；禁止 `update`、`fix bug`、`修改` 这类无信息标题。
- 提交信息检查由 `commit-convention.yml` 给出提示（非必需检查，避免卡死外部贡献）。

---

## 4. 拆分矩阵：什么时候必须开多个 PR

判定：用一句话描述 PR，若需"并且/顺便"就已越界。

| 你的改动 | 拆分方式 |
| --- | --- |
| 修 bug 时发现命名不好 | `fix/...` 先合，`refactor/...` 后开 |
| 新功能顺带改旧逻辑 | `feat/...` 与 `fix/...` 分开，fix 先合 |
| 依赖升级 + 适配代码 | 依赖升级独立 `chore(deps)`，适配代码独立 PR（可注明依赖顺序） |
| 全仓格式化 + 功能 | 格式化单独 PR，先合 |
| 模板 / CODEOWNERS / Actions | 独立 `chore(ci)` 或 `docs` PR |
| 文档更新 + 代码 | 文档可跟随功能 PR（同主题），但`docs/` 结构性重写单独开 |
| 存储层跨后端改动 | **同一个 PR**（KV/D1/Hyperdrive 必须一致），不拆 |
| 新增字段贯穿 db→api→web→openapi | **同一个 PR**，在描述「改动范围」注明不可拆原因 |

依赖型 PR 用描述里的 `Depends on #123` 标注，先合被依赖者。

---

## 5. 一个 PR 的完整生命周期

```bash
# 1. 同步基线
git switch main && git pull --ff-only
git switch -c fix/d1-pagination-overflow

# 2. 改动 + 最小提交
git add functions/_shared/db-d1.js
git commit            # 走 .gitmessage

# 3. 本地验证（必须真实执行，输出贴进 PR）
npm run lint
npm run build
npm run server & curl -fsS http://localhost:3000/healthz; npm run stop

# 4. 推送并开 PR
git push -u origin fix/d1-pagination-overflow
gh pr create --fill --base main
```

PR 描述按模板六节填写；缺「验证证据」会被 `pr-hygiene.yml` 提示。

合并前状态机：

```
分支就绪 → lint/build 本地通过 → PR 已开 → CI Quality Gate 绿
        → CODEOWNERS 批准 → 🔴 全部解决 → 合并 → 删分支
```

---

## 6. CI 门禁

| 工作流 | 触发 | 是否必需 | 内容 |
| --- | --- | --- | --- |
| `CI Quality Gate`（`ci.yml`） | push/PR → main | **必需** | Node 22 + `npm ci` → `npm run lint` → `npm run build` |
| `PR Hygiene`（`pr-hygiene.yml`） | PR 事件 | 建议必需 | size/* 标签、禁止入库文件、治理+源码混改提示、证据检查 |
| `PR Labeler`（`pr-labeler.yml`） | PR 事件 | 否 | 按 `labeler.yml` 打 scope 标签 |
| `Commit Convention`（`commit-convention.yml`） | PR 事件 | 否（仅提示） | PR 标题与提交首行格式（含 scope 白名单） |
| `Docker Build & Publish`（`docker-publish.yml`） | tag `v*` / main / PR | 建议必需（PR 仅构建） | 多架构镜像构建，tag 时推送 |
| `Sync Upstream`（`sync-upstream.yml`） | 定时 | 否 | 每 6 小时同步上游 |

**本仓库没有测试框架**（`tests/` 与 vitest 已移除，`package.json` 无 `test` 脚本）。不要在任何 PR 里顺手引入测试门禁；如确需引入，单独开 issue 讨论并独立成 PR。

---

## 7. 标签

`.github/labels.yml` 是唯一事实来源，YAML 映射结构 `<标签名>: { color, description }`。批量导入：

```bash
# 需要 gh 已登录且有仓库写权限
python3 - <<'EOF' > /tmp/labels.tsv
import yaml
d = yaml.safe_load(open('.github/labels.yml', encoding='utf-8'))
for name, meta in d.items():
    print(f"{name}\t{meta['color']}\t{meta['description']}")
EOF

while IFS=$'\t' read -r name color desc; do
  gh label create "$name" --color "$color" --description "$desc" --force
done < /tmp/labels.tsv
```

标签分组：类型（feat/fix/…）、模块（scope/*）、状态（needs-triage…）、风险（breaking/security/data-migration）、规模（size/*，由 `pr-hygiene.yml` 自动写入）、部署形态（deploy/*）。

大量 `--force` 覆盖会重置已有标签颜色；已有自定义配色时先手工比对再导入。

---

## 8. 落地顺序（首次启用）

按此顺序执行，每步一个独立 PR，前一步合并后再开下一步：

| # | PR 标题 | 内容 | 依赖 |
| --- | --- | --- | --- |
| 1 | `chore: 新增提交模板与本地校验钩子` | `.gitmessage`、`.githooks/commit-msg`、`scripts/install-git-hooks.sh`、`.gitignore`（取消忽略 `CLAUDE.md`） | — |
| 2 | `chore: 新增 PR/Issue 模板与审查标准` | `.github/pull_request_template.md`、`.github/ISSUE_TEMPLATE/*`、`.github/REVIEW_GUIDELINES.md`、`.github/CODEOWNERS` | 1（不强制） |
| 3 | `chore(ci): 新增 PR 卫生检查、自动打标与提交信息检查` | `.github/labels.yml`、`.github/labeler.yml`、`pr-hygiene.yml`、`pr-labeler.yml`、`commit-convention.yml` | 2（不强制） |
| 4 | `docs: 新增贡献指南与工程文档` | `CONTRIBUTING.md`、`CONTRIBUTING_EN.md`、`docs/**`（8 篇）、README 双语「开发与贡献」章节 | 1–3（文中链接指向它们） |
| 5 | `docs: 新增 AI 编码助手规则` | `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`.cursor/rules/repo.mdc` | 4（AGENTS 引用 CONTRIBUTING 与 docs） |

五个 PR 的主题互不重叠：1 管本地提交体验，2 管协作入口与审查口径，3 管自动化信号，4 管人类文档，5 管 AI 规则。**合并顺序 1 → 2 → 3 → 4 → 5**，因为后续 PR 的文档会链接到前面的文件。

全部合并后在 GitHub 网页完成一次设置：分支保护、必需检查、标签导入（见 `BRANCH_PROTECTION.md`）。

---

## 9. 常见问题

**Q：改动只有一行，也要开 PR 吗？** 是的。`main` 受保护，绕过 PR 会让 CI 与审查失去意义。一行文档修正也走 PR，但描述可以精简。

**Q：PR 被要求拆分，但我已提交在一起怎么办？** 用 `git rebase -i` 把提交按主题重排，再按 `git checkout -b` 拆分支；或 `git cherry-pick` 到新分支。**不要**直接关掉 PR 重开而不保留讨论记录。

**Q：CI 报的 error 是既有的怎么办？** 先确认是否本次引入（`git stash` 后复跑）。既有错误单独开 `fix` PR，不在当前 PR 顺手修。

**Q：需要改 `.github/` 但功能 PR 正等合并？** 治理文件 PR 可以并行，但功能 PR 里不能同时出现它们；否则 `pr-hygiene.yml` 会提示拆分。
