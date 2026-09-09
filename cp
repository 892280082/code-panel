#!/usr/bin/env bash
# ── cp —— code-panel 本机免密调用器 ──────────────────────────────────────────
#   脚本本体随 code-panel 仓库走;别的项目/AI 直接调本脚本,无需知道端口/密码/token。
#
#   用法:
#     cp get    /api/inspect?project=4                     # 改完 yaml 一发自检
#     cp get    /api/logs?project=4
#     cp post   /api/sql/query -d '{"dbId":"hq","sql":"select 1"}'
#     cp put    /api/projects/4/yaml/links -d @body.json   # @文件 传 JSON body
#     cp delete /api/db/db1?project=4
#     cp raw    /api/stream?project=4                      # 不解析信封,原样输出(SSE/HTML)
#
#   鉴权:自动读本机 ~/.code-panel/ai-token(0600,面板启动时生成)= 本机免密,
#         含安全模式直通;远程机器没有该文件,照常走登录,天然只有本机能免密。
#   边界:SQL 审批(approve/reject/review-mode)对本通道 403 —— 审批必须人工操作。
set -euo pipefail

CP_HOME="${CODE_PANEL_HOME:-$HOME/.code-panel}"
CP_PORT="${CODE_PANEL_PORT:-3008}"
TOKEN_FILE="$CP_HOME/ai-token"

method="${1:-}"; path="${2:-}"; shift 2 || true
[ -n "$method" ] && [ -n "$path" ] || { sed -n '2,17p' "$0" | sed 's/^# *//'; exit 2; }
method="$(echo "$method" | tr '[:lower:]' '[:upper:]')"
raw=0; data=()
while [ $# -gt 0 ]; do
  case "$1" in
    -d|--data) data+=(-d "$2"); shift 2 ;;
    --raw) raw=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "✗ 本机还没有免密 token($TOKEN_FILE)。先启动一次面板生成:" >&2
  echo "  bash ~/.claude/skills/code-panel/start.sh" >&2
  exit 1
fi

case "$path" in
  http*) url="$path" ;;
  *)     url="http://127.0.0.1:${CP_PORT}${path}" ;;
esac

body="$(curl -s -m 20 -X "$method" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  ${data[@]+"${data[@]}"} "$url")"

# raw 模式 / 非 JSON 响应:原样输出
if [ "$raw" = 1 ] || ! echo "$body" | python3 -c 'import sys,json;json.load(sys.stdin)' 2>/dev/null; then
  echo "$body"
  exit 0
fi

echo "$body" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("ok"):
    v = d.get("data", d)
    print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, indent=2))
else:
    print("✗ " + str(d.get("error", d)), file=sys.stderr)
    sys.exit(1)
'
