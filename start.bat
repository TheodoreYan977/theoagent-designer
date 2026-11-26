@echo off
setlocal
title TheoAgent Designer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [theoagent-designer] Node.js not found.
  echo Please install Node.js LTS from https://nodejs.org/ and run again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [theoagent-designer] First run: installing dependencies ^(puppeteer-core^)...
  call npm install
  if errorlevel 1 (
    echo [theoagent-designer] npm install failed. Check your network and try again.
    pause
    exit /b 1
  )
)

echo [theoagent-designer] Checking for a previous instance on port 8090 ...
call :stopPrevious 8090

echo [theoagent-designer] Starting... your browser will open at http://127.0.0.1:8090
node server.mjs
if errorlevel 1 pause
exit /b 0

:stopPrevious
set "THEO_PORT=%~1"
rem 1) 优先用 PowerShell：结束旧 node，并连同旧 cmd 窗口一起关掉
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-service.ps1" %THEO_PORT% 2>nul
rem 2) 兜底：若端口仍被占用，用 netstat 精确结束监听进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%THEO_PORT%" ^| findstr "LISTENING"') do (
  echo   Stopping leftover instance ^(PID %%a^) ...
  taskkill /F /T /PID %%a >nul 2>nul
)
rem 3) 留一点时间给系统释放端口（ping 比 timeout 更兼容 stdin 被重定向的场景）
ping -n 2 127.0.0.1 >nul
exit /b 0
