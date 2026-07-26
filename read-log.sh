#!/bin/bash
# Log Viewer + SQL Review Panel — v3 (Vue 3)
# 启动后台服务并打开浏览器

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3008

# 检查是否已在运行
if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "read-log 已在运行 → http://localhost:$PORT/log"
    xdg-open http://localhost:$PORT/log 2>/dev/null || open http://localhost:$PORT/log 2>/dev/null
    exit 0
fi

cd "$SKILL_DIR"

# 检查前端是否已构建
if [ ! -f frontend/dist/index.html ]; then
    echo "构建前端 (Vue 3)..."
    cd frontend && npm install --silent && npx vite build && cd "$SKILL_DIR"
fi

echo "启动 read-log v3..."
nohup npx tsx src/server.ts > /dev/null 2>&1 &
sleep 2
if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "启动成功 → http://localhost:$PORT/log"
else
    echo "启动失败"
fi
