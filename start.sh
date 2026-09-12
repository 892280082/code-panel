#!/bin/bash
# Log Viewer + SQL Review Panel — 一键启动脚本
# 自动安装依赖 + 构建前端 + 启动后台

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3008

# systemd 托管的机器(Linux 面板服务):一律转交 systemctl,由单元 ExecStartPre 清场后接管,
# 杜绝"手动实例 vs 服务"抢 3008 打架(2026-09-12 3700 事故:孤儿实例抢端口 → 服务崩溃循环 135 次)
if command -v systemctl >/dev/null 2>&1 && systemctl --user cat code-panel >/dev/null 2>&1; then
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    echo "🔄 面板由 systemd 托管 → systemctl --user restart code-panel(restart 对未运行状态等同 start)"
    exec systemctl --user restart code-panel
fi

# 检查是否已在运行
if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "⏳ 服务已在运行 → http://localhost:$PORT/log"
    exit 0
fi

cd "$SKILL_DIR"

echo "📦 安装后端依赖..."
npm install --silent

echo "📦 安装前端依赖..."
cd frontend && npm install --silent && cd "$SKILL_DIR"

# 构建前端（如果未构建）
if [ ! -f frontend/dist/index.html ]; then
    echo "🔧 构建前端 (Vue 3)..."
    cd frontend && npx vite build && cd "$SKILL_DIR"
fi

echo "🚀 启动服务 → http://localhost:$PORT"
nohup npx tsx src/server.ts > /dev/null 2>&1 &
sleep 2

if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "✅ 启动成功"
    echo "   日志面板: http://localhost:$PORT/log"
    echo "   SQL 面板: http://localhost:$PORT/sql"
    xdg-open http://localhost:$PORT/log 2>/dev/null || open http://localhost:$PORT/log 2>/dev/null
else
    echo "❌ 启动失败，请检查错误日志"
fi
