# 发布流程 · Release

> 涉及两条发布通道：**Docker 镜像**（`docker-publish.yml`）与 **Cloudflare Pages**（Git 集成，无自定义工作流）。
> 版本号事实来源：根 `package.json` 的 `version` 与 `openapi.yaml` 的 `info.version`，二者必须一致。

---

## 1. 版本与 tag

- 语义化版本：`MAJOR.MINOR.PATCH`。破坏性变更（含环境变量改名、存储结构变化）升 MAJOR。
- tag 格式 `v<version>`，例：`v2.0.1`。推送 tag 会触发多架构镜像构建并推送到 Docker Hub。
- 变更记录写在 GitHub Release 描述里：按 `feat` / `fix` / `perf` / `docs` / `chore` 分组，破坏性变更置顶并给出迁移步骤。

```bash
# 发布前：确认 main 干净且 CI 绿
git switch main && git pull --ff-only
gh run list --branch main --limit 5

# 升版本（同步两处）
# 1) package.json: "version"
# 2) openapi.yaml: info.version
npm run lint && npm run build

git commit -am "chore(release): v2.0.1"
git tag -a v2.0.1 -m "v2.0.1"
git push origin main --follow-tags
```

---

## 2. Docker 通道

`docker-publish.yml` 行为：

| 触发 | 行为 |
| --- | --- |
| push tag `v*` | 构建多架构镜像并推送 Docker Hub（`kakuwari/tg-chatbot`） |
| push `main` | 构建并推送对应分支标签 |
| pull_request → `main` | **仅构建校验，不推送** |

必需 Secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。

发布后自检：

```bash
docker pull kakuwari/tg-chatbot:v2.0.1
docker compose up -d
curl -fsS http://localhost:3000/healthz && echo OK
docker compose logs --tail=50
```

镜像要点：构建阶段使用 `--platform=$BUILDPLATFORM`（见 `Dockerfile` 注释），避免 QEMU 下 Node/esbuild 触发 SIGILL；`server/` 依赖单独安装（`--omit=dev`），不要把根依赖混进运行层。

---

## 3. Cloudflare Pages 通道

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Functions 目录 | `functions/`（`/api/*` → `functions/api/[[path]].js`，`/webhook` → `functions/webhook.js`） |
| 绑定 | `KV`（必需）、`D1`（可选）、`HYPERDRIVE`（可选） |
| 环境变量 | 参考 `.env.example` 与 `db-settings.js#DEFAULT_SETTINGS` |

发布后自检：

1. 打开站点，`/login` 可访问（SPA 回退正常）。
2. 管理员登录成功（Cookie 正常下发；HTTPS 下确认 `COOKIE_SECURE`）。
3. Bot webhook 已指向 `/webhook`，发送一条私聊能看到建话题与转发。
4. 切换 `ACTIVE_DB` 后验证对应后端读写（Hyperdrive 需要 `DATABASE_URL`）。

---

## 4. 回滚

| 场景 | 操作 |
| --- | --- |
| 镜像有问题 | 重新部署上一个 tag：`docker compose` 中把镜像固定为 `kakuwari/tg-chatbot:v<上一个>` |
| Pages 有问题 | Cloudflare 控制台 Deployments 中选择上一个成功部署 → Rollback |
| 代码有问题 | `git revert <sha>` 开 PR 合入，**不要** force push `main`，不要删 tag |
| 配置有问题 | 环境变量/设置项改回旧值；涉及加密密钥（`KV_ENCRYPTION_KEY`）变更需按备份恢复 |

数据侧注意：更换 `KV_ENCRYPTION_KEY` 会导致既有数据无法解密，回滚时密钥必须与数据写入时一致。

---

## 5. 发布检查清单

- [ ] `main` 上 `CI Quality Gate` 绿
- [ ] `package.json` 与 `openapi.yaml` 版本一致
- [ ] `.env.example`、`docker-compose.yml`、README 双份已同步新增配置
- [ ] Docker：镜像可拉取，`/healthz` 正常，日志无异常栈
- [ ] Cloudflare：登录、webhook、受影响接口实测通过
- [ ] Release 描述含破坏性变更与迁移步骤（如有）
- [ ] 回滚路径已确认可用
