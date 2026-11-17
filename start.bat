@echo off
setlocal
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

echo [theoagent-designer] Starting... your browser will open at http://127.0.0.1:8090
node server.mjs
if errorlevel 1 pause
