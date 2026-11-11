# 安全漏洞上报 · Security Reporting

> 本项目是处理 Telegram 用户私聊内容与管理员凭据的服务端应用，漏洞影响面直接落在真实用户数据上。
> **请不要用公开 issue 披露漏洞细节。**

---

## 1. 上报渠道

| 渠道 | 地址 | 适用 |
| --- | --- | --- |
| GitHub 私密漏洞报告 | 仓库 **Security → Report a vulnerability** | 首选，带私密讨论线程与 CVE 申请入口 |
| 邮件 | `security@<维护者域名>`（占位，替换为实际邮箱） | 无法使用上者时 |

请在标题中包含受影响组件，例如：`[auth] 会话固定导致越权`。

---

## 2. 请提供的信息

1. **受影响版本**：镜像 tag / `git rev-parse --short HEAD` / release 版本。
2. **部署形态**：Cloudflare Pages（KV / D1 / Hyperdrive）或 Docker / 本地 Node。
3. **影响组件**：`auth` / `totp` / `captcha` / `cors` / `db-*` / `bot-*` / `api` 路由。
4. **复现步骤**：最小可复现步骤，含请求样例（**去掉你自己的 token 与 Cookie**）。
5. **影响评估**：能否越权读取他人会话、能否绕过人机验证、能否提权为管理员。
6. **是否已公开**：是否已告知第三方、是否有公开 PoC。

---

## 3. 重点关注面

结合本项目结构，以下区域属于高优先级：

| 区域 | 文件 | 典型问题 |
| --- | --- | --- |
| 认证与会话 | `functions/_shared/auth.js`、`totp.js` | 会话固定、Cookie 属性缺失、时序比较绕过 |
| 跨站与来源校验 | `functions/_shared/cors.js` | CORS 放开为 `*`、CSRF 来源校验绕过 |
| 人机验证 | `functions/_shared/captcha.js`、`bot-verify.js` | 验证结果可伪造、重放、服务端未校验 |
| Webhook 鉴权 | `functions/webhook.js` | `X-Telegram-Bot-Api-Secret-Token` 校验绕过 |
| 存储层 | `functions/_shared/db-*.js` | SQL 拼接注入、键空间越界读写 |
| 管理接口 | `functions/api/routes/*` | 未授权访问、IDOR、越权改设置 |
| 运维 CLI | `scripts/admin-recovery.js` | 提权重置、明文输出敏感信息 |

**已实现的安全机制**（如需评估是否可绕过，直接针对它们）：PBKDF2 密码哈希、可选 TOTP 2FA、`timingSafeEqualStr` 常量时间比较、CORS 白名单（默认同源）、CSRF 来源校验、审计日志 `audit-log.js`、Webhook secret 校验、`_redirects` 对探测路径返回 404、`op-lock.js` 写操作互斥。

---

## 4. 处理流程与时限

| 阶段 | 目标时限 |
| --- | --- |
| 确认收到 | 3 个工作日内 |
| 初步评估（是否成立、影响面） | 7 个工作日内 |
| 修复或缓解方案 | 依严重程度，Critical 优先排期 |
| 公开披露 | 修复版本发布后，经双方同意 |

修复走正常 PR 流程（见 [`GITHUB_WORKFLOW.md`](GITHUB_WORKFLOW.md)），但 PR 标题与描述**不含**可被直接利用的细节；细节留在私密报告线程里。

---

## 5. 不在范围内

- 需要物理接触设备或已 root 的攻击者本地环境
- 依赖第三方平台（Telegram、Cloudflare、Docker Hub）自身的漏洞 —— 请直接报给对应厂商
- 缺少实际影响的扫描器报告（如仅输出 `Server` 头、无 PoC 的"最佳实践"清单）
- 社会工程学攻击维护者
- 自动化工具对演示实例的高频探测（请只在自建实例验证）

---

## 6. 致谢

确认有效的报告会在修复发布后记入 release notes 的致谢段（如报告者同意署名）。请一并告知希望使用的署名与链接。
