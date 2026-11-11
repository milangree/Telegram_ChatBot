#!/bin/sh
# scripts/install-git-hooks.sh
# 安装仓库自带的 git 钩子（当前仅 commit-msg：校验提交信息格式）
# 用法：bash scripts/install-git-hooks.sh
# 卸载：git config --unset core.hooksPath

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -d .githooks ]; then
  echo "✖ 未找到 .githooks 目录（应在仓库根目录）" >&2
  exit 1
fi

chmod +x .githooks/* 2>/dev/null || true
git config --local core.hooksPath .githooks
git config --local commit.template .gitmessage

echo "✔ 已启用 git 钩子：core.hooksPath = .githooks"
echo "✔ 已启用提交模板：commit.template = .gitmessage"
echo
echo "验证：故意提交一条不合规信息应被拦下"
echo "  git commit --allow-empty -m 'update'"
echo "绕过：git commit --no-verify"
