#!/usr/bin/env bash
# 一键发布插件:重算索引 → 校验 → 提交 → 推送(用 gh 凭据,免手动输密码)
# 用法: tools/publish.sh "feat(sudashui): 1.0.2 支持 XX"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MSG="${1:-chore: 更新插件}"

echo "==> 1/4 重算 index.json"
node tools/build-index.mjs

echo "==> 2/4 校验索引与插件源码一致"
node tools/build-index.mjs --check

echo "==> 3/4 提交(触发 .githooks/pre-commit 再确认一次)"
git -c core.hooksPath=.githooks add -A
if git diff --cached --quiet; then
  echo "    没有需要提交的改动,退出"
  exit 0
fi
git -c core.hooksPath=.githooks commit -m "$MSG"

echo "==> 4/4 推送"
git -c credential.helper='!gh auth git-credential' push origin main

echo
git log --oneline -1
echo "完成。jsDelivr 会自动跟随(约数秒);市场源无需重新添加。"
