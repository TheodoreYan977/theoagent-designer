# TheoAgent 图文设计器

本地运行的小红书图文排版工具：在浏览器里拖动排版、改字体，一键导出封面图和图文笔记 PNG。

## 快速开始

1. 双击 `start.bat`（首次会自动安装依赖）。
2. 浏览器自动打开 http://127.0.0.1:8090 。

## 要求

- [Node.js](https://nodejs.org/) ≥ 20（LTS 即可）
- 预览不需要 Chrome；**导出 PNG** 需要本机已装 [Chrome](https://www.google.com/chrome/) 或 Edge

## 功能

- 两块画布：**封面 1242×1660**、**图文笔记 1080×1440**（顶部 tab 切换）
- 自由拖动元素，改字体 / 字号 / 颜色 / 对齐 / 位置 / 圆角 / 边框
- 添加文字、图片、色块；上移 / 下移 / 删除
- 撤销 `Ctrl+Z`，重做 `Ctrl+Shift+Z`（或 `Ctrl+Y`）
- 文字内容用 `{title_en}`、`{en}`、`{note}` 等占位符（预览自动填样例数据）
- 保存模板 → `template.json`；导出 PNG → `output/`

## 图片怎么填

图片元素的 `src` 支持三种写法：

| 写法 | 预览 | 导出 PNG |
|---|---|---|
| 相对路径 `images/cover.jpg`（放本文件夹下） | ✅ | ✅ |
| data URL（粘贴 base64） | ✅ | ✅ |
| 绝对路径 `D:\pic\cover.jpg` | ❌（浏览器读不到任意本地路径） | ✅ |

## 字体

内置 4 款开源字体（SIL OFL 1.1）：Smiley Sans（得意黑）、Noto Serif、Noto Sans、Noto Sans SC。
