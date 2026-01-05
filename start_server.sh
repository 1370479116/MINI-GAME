#!/bin/bash
cd "$(dirname "$0")"
echo "正在启动游戏服务器..."
echo "服务器地址: http://localhost:8000"
echo "按 Ctrl+C 停止服务器"
python3 -m http.server 8000


