#!/bin/bash
# Log Viewer + SQL Review Panel — 一键启动脚本
# 自动安装依赖 + 构建前端 + 启动后台

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3008

# 检查是否已在运行
if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "⏳ 服务已在运行 → http://localhost:$PORT/log"
    xdg-open http://localhost:$PORT/log 2>/dev/null || open http://localhost:$PORT/log 2>/dev/null
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
