# 分支保护与仓库设置 · Branch Protection

> 目标：让 `main` 只能通过「单一主题 PR + 绿 CI + CODEOWNERS 审查」进入。
> 本文所有设置有对应的 UI 路径与 `gh` 命令两种写法，二选一执行。

---

## 1. 分支保护规则（`main`）

**Settings → Branches → Add branch protection rule**（或 Branch rulesets）

| 设置项 | 值 | 理由 |
| --- | --- | --- |
| Branch name pattern | `main` | 唯一长期分支 |
| Require a pull request before merging | ✅ | 禁止直推 |
| └ Required approvals | `1` | 单人维护仓库的务实下限 |
| └ Dismiss stale approvals on new commits | ✅ | 改完代码要重审 |
| └ Require review from Code Owners | ✅ | 让 `.github/CODEOWNERS` 生效 |
| └ Require approval of the most recent reviewable push | ✅ | 防止审查后再偷改 |
| Require status checks to pass | ✅ | CI 门禁 |
| └ Require branches to be up to date | ✅ | 避免"绿着合并后挂掉" |
| └ Required checks | `CI Quality Gate / lint-and-build`、`PR Hygiene / 规模与拆分检查`、`Docker Build & Publish / build-and-push` | 见下节说明 |
| Require conversation resolution | ✅ | 🔴 意见必须闭环 |
| Require linear history | ⬜（建议关闭） | 允许 merge commit，不做无意义 squash 历史重写 |
| Require signed commits | ⬜（可选） | 仅当维护者本地已配 GPG/SSH 签名 |
| Require deployments to succeed | ⬜ | 无 staging 环境 |
| Lock branch | ⬜ | 需要持续合入 |
| Do not allow bypassing the above settings | ✅ | 管理员同样走 PR（紧急除外，见下） |
| Restrict who can push | ✅ 仅维护者 | 配合 PR 要求 |
| Allow force pushes | ❌ | 严禁强推共享分支 |
| Allow deletions | ❌ | 防止误删 |

### 必需检查的说明

| 检查名 | 来源 | 是否设为必需 | 说明 |
| --- | --- | --- | --- |
| `CI Quality Gate / lint-and-build` | `ci.yml` | **必需** | Node 22 + `npm ci` → `npm run lint` → `npm run build` |
| `PR Hygiene / 规模与拆分检查` | `pr-hygiene.yml` | 建议必需 | 只产出信号、不主动 fail，设为必需可保证它一定运行 |
| `Docker Build & Publish / build-and-push` | `docker-publish.yml` | 建议必需 | PR 上只构建校验，tag 时才推镜像 |
| `PR Labeler` / `Commit Convention` | 对应工作流 | 不建议必需 | 纯提示性，卡死外部贡献者得不偿失 |

> 检查名以首次运行后在 PR 页面显示的实际名称为准（`<workflow name> / <job name>`）。先让工作流跑过一次，再回到设置里勾选。

---

## 2. `gh` 命令写法

```bash
# 需要 admin 权限：gh auth refresh -s admin:repo_hook,repo
gh api -X PUT repos/milangree/Telegram_ChatBot/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=CI Quality Gate / lint-and-build" \
  -f "required_status_checks[contexts][]=PR Hygiene / 规模与拆分检查" \
  -f "enforce_admins=true" \
  -f "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -f "required_pull_request_reviews[require_code_owner_reviews]=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -f "restrictions[users][]=milangree" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false" \
  -F "required_conversation_resolution=true"
```

`contexts` 名称必须和实际检查名完全一致；用下面命令核对是否已出现：

```bash
gh pr checks <PR号>          # 列出该 PR 的检查名与状态
gh api repos/milangree/Telegram_ChatBot/commits/main/check-runs --jq '.check_runs[].name'
```

---

## 3. 仓库级设置

| 位置 | 设置 | 值 |
| --- | --- | --- |
| Settings → General → Pull Requests | Allow merge commits | ✅（保留完整历史） |
| 同上 | Allow squash merging | ✅（功能 PR 可用） |
| 同上 | Allow rebase merging | ✅ |
| 同上 | Always suggest updating pull request branches | ✅ |
| 同上 | Automatically delete head branches | ✅ |
| 同上 | Allow auto-merge | ✅ |
| Settings → General → Issues | Allow issues | ✅ |
| Settings → Features | Discussions | ✅（承接部署/使用问题） |
| Settings → Code security | Dependabot alerts / security updates | ✅ |
| Settings → Secrets | `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN` | 供 `docker-publish.yml` 使用 |

---

## 4. 自动合并与依赖 PR

依赖型 PR（后一个基于前一个分支）用以下流程，避免互相卡住：

```bash
# B 依赖 A
git switch featA && git push -u origin featA
gh pr create --base main --head featA --title "feat(web): 话题归档入口"
git switch -c featB featA
gh pr create --base featA --head featB --title "feat(api): 归档接口"
# A 合并后，把 B 的 base 改成 main
gh pr edit <B号> --base main
```

PR 描述里写 `Depends on #<A号>`，审查者按顺序处理。

---

## 5. 紧急通道（hotfix）

线上故障时**仍走 PR**，只是缩短流程：

1. `hotfix/<现象>` 从 `main` 拉出，只含最小修复，禁止夹带重构。
2. PR 描述注明「线上故障」+ 影响范围 + 回滚命令。
3. CI 必须绿；CODEOWNERS 审查可为事后复核（在 PR 里明确记录谁批准、何时补审）。
4. 合并后立刻打 tag 走 `docker-publish.yml`，并在 issue 里补一条事故记录。
5. 严禁 `git push --force` 到 `main`，也不允许关闭保护规则来绕过。

---

## 6. 验收（设置完成后逐条核对）

- [ ] 直接 `git push origin main` 被拒绝（提示需要 PR）
- [ ] 新开 PR 后，`CI Quality Gate`、`PR Hygiene` 自动出现并运行
- [ ] `gh pr checks` 能看到与本文一致的检查名
- [ ] 未经 CODEOWNERS 批准时合并按钮为灰
- [ ] 同一个 PR 里同时改 `.github/**` 与 `src/**` 时，`PR Hygiene` 日志出现"应拆成两个 PR"提示
- [ ] 新增提交后旧批准被 dismiss
- [ ] 合并后源分支自动删除
