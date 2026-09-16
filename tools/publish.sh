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

echo "==> 4/5 推送"
git -c credential.helper='!gh auth git-credential' push origin main

echo "==> 5/5 刷新 jsDelivr 缓存(不刷新的话市场源最长 12 小时还在发旧索引)"
PURGE="https://purge.jsdelivr.net/gh/xiaoqi0102/newapi-plugins@main"
TARGETS="$PURGE/index.json"
for f in $(git show --name-only --pretty=format: HEAD); do
  case "$f" in plugins/*) TARGETS="$TARGETS $PURGE/$f" ;; esac
done
for u in $TARGETS; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$u" || echo 000)
  echo "    purge HTTP $code  ${u##*@main/}"
done

echo
git log --oneline -1
echo "完成。市场源无需重新添加;若上面 purge 不是 200,手动再跑:"
echo "    curl -sS $PURGE/index.json"
