# 文档索引 · Docs

本目录放**工程文档**；面向使用者的部署与功能说明仍在根目录 README。

| 文档 | 内容 | 何时读 |
| --- | --- | --- |
| [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md) | 分支模型、提交规范、PR 拆分矩阵、CI 门禁、落地顺序 | 提 PR 前 |
| [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md) | `main` 保护规则、必需检查、仓库设置、hotfix 通道 | 维护者配置仓库时 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、双运行时模型、存储抽象、请求链路 | 改结构或排查跨层问题时 |
| [API.md](API.md) | API 约定、路由清单、认证方式、`openapi.yaml` 维护方式 | 改接口时 |
| [RELEASE.md](RELEASE.md) | 版本号、tag、镜像发布、Cloudflare 部署、回滚 | 发版时 |
| [SECURITY_REPORTING.md](SECURITY_REPORTING.md) | 漏洞上报渠道、关注面、处理时限 | 发现安全问题 / 评估安全影响 |
| [examples/PR_EXAMPLE.md](examples/PR_EXAMPLE.md) | 填好的 PR 描述样例（证据写到什么程度） | 第一次提 PR 时对照 |

仓库治理与 AI 规则：

| 文件 | 内容 |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) / [../CONTRIBUTING_EN.md](../CONTRIBUTING_EN.md) | 贡献指南（中/英） |
| [../AGENTS.md](../AGENTS.md) | AI 编码助手规则（所有助手） |
| [../CLAUDE.md](../CLAUDE.md) | Claude Code 入口摘要 |
| [../.github/copilot-instructions.md](../.github/copilot-instructions.md) | Copilot 指令 |
| [../.cursor/rules/repo.mdc](../.cursor/rules/repo.mdc) | Cursor 规则 |
| [../.github/REVIEW_GUIDELINES.md](../.github/REVIEW_GUIDELINES.md) | 审查标准与分级 |
| [../.github/pull_request_template.md](../.github/pull_request_template.md) | PR 模板 |

模板与自动化：

| 文件 | 作用 |
| --- | --- |
| [../.gitmessage](../.gitmessage) | 提交信息模板 |
| [../.github/ISSUE_TEMPLATE/bug_report.yml](../.github/ISSUE_TEMPLATE/bug_report.yml) | Bug 表单 |
| [../.github/ISSUE_TEMPLATE/feature_request.yml](../.github/ISSUE_TEMPLATE/feature_request.yml) | 功能表单 |
| [../.github/ISSUE_TEMPLATE/config.yml](../.github/ISSUE_TEMPLATE/config.yml) | issue 入口配置 |
| [../.github/CODEOWNERS](../.github/CODEOWNERS) | 审查归属 |
| [../.github/labels.yml](../.github/labels.yml) | 标签清单 |
| [../.github/labeler.yml](../.github/labeler.yml) | 路径→标签映射 |
| [../.github/workflows/ci.yml](../.github/workflows/ci.yml) | 必需门禁 lint + build |
| [../.github/workflows/pr-hygiene.yml](../.github/workflows/pr-hygiene.yml) | PR 规模与卫生检查 |
| [../.github/workflows/pr-labeler.yml](../.github/workflows/pr-labeler.yml) | 自动打标签 |
| [../.github/workflows/commit-convention.yml](../.github/workflows/commit-convention.yml) | 提交信息提示 |
| [../.github/workflows/docker-publish.yml](../.github/workflows/docker-publish.yml) | 镜像构建与发布 |
| [../.github/workflows/sync-upstream.yml](../.github/workflows/sync-upstream.yml) | 上游同步 |

维护约定：新增文档放本目录并在上表登记；结构与命令变化时同步 `AGENTS.md` 第 2 节的模块路由表。
