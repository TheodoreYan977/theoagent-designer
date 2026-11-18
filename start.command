#!/bin/bash
# TheoAgent 图文设计器 · macOS 一键启动（双击本文件即可）
cd "$(dirname "$0")" || exit 1

echo "======================================"
echo "  TheoAgent 图文设计器 · macOS"
echo "======================================"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "未检测到 Node.js。"
  echo "请先到 https://nodejs.org/ 下载安装 LTS 版本，然后再双击本文件。"
  echo ""
  read -n 1 -s -r -p "按任意键关闭..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "首次运行，正在安装依赖（puppeteer-core），请稍候……"
  echo ""
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "依赖安装失败，请检查网络后重试。"
    read -n 1 -s -r -p "按任意键关闭..."
    exit 1
  fi
fi

echo ""
echo "启动中……浏览器会自动打开 http://127.0.0.1:8090"
echo "（关闭本窗口 / 按 Ctrl+C 可停止服务）"
echo ""
node server.mjs
