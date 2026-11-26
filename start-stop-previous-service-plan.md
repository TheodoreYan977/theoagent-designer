# 启动时先关闭上一个服务（含旧窗口）再拉起新服务 —— 执行计划

> 分支：`fix/start-stop-previous-service`（基于 `origin/main` = 83798f9）。
> 范围：`start.bat`（Windows，主改）+ 新增 `stop-service.ps1` + `start.command`（macOS）+ `server.mjs`（兜底提示）。

## 1. 现状

- `start.bat` 依次：检查 Node → 首次 `npm install` → 直接 `node server.mjs`（前台，端口 8090）。
- `server.mjs` 绑定 `127.0.0.1:8090`；端口被占时 Node 抛 `EADDRINUSE`，bat 走 `if errorlevel 1 pause` 卡住。
- 没有「先关掉上一个服务」的逻辑；上一个 `node` 死了以后，它的 `cmd` 控制台窗口还会停在 `Press any key`。
- `uninstall.bat` 已有 `netstat + taskkill` 按端口找 PID 的写法，可复用。

## 2. 需求

点 `start.bat` 时：
1. 检测 8090 上是否有上一个服务；
2. 有则结束它，**并把它所在的旧控制台窗口一起关掉**；
3. 再拉起新服务、打开浏览器。

## 3. 方案

### 3.1 新增 `stop-service.ps1`（关闭旧 node + 旧窗口）

只杀 node 不够，旧窗口会残留。所以拿到「监听 8090 的 node」的**父进程**：如果父进程是 `cmd.exe`（双击 bat 启动时的控制台），用 `taskkill /F /T /PID <父cmd>` 连窗口一起结束；否则只杀 node（不误伤手动终端）。

```powershell
param([int]$Port = 8090)
$ErrorActionPreference = 'SilentlyContinue'

$conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$pids = @()
foreach ($c in $conns) {
  if ($pids -notcontains $c.OwningProcess) { $pids += $c.OwningProcess }
}

foreach ($procId in $pids) {
  $nodeInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
  if (-not $nodeInfo) { continue }
  $parentId = $nodeInfo.ParentProcessId
  $parentInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId"
  $isConsole = $false
  if ($parentInfo -and $parentInfo.Name -eq 'cmd.exe' -and $parentInfo.CreationDate -le $nodeInfo.CreationDate) { $isConsole = $true }

  if ($isConsole) {
    Write-Output "  Stopping previous instance (node PID $procId) and its console window (cmd PID $parentId) ..."
    & taskkill /F /T /PID $parentId | Out-Null
  } else {
    Write-Output "  Stopping previous instance (node PID $procId) ..."
    & taskkill /F /PID $procId | Out-Null
  }
}

if ($pids.Count -gt 0) { Start-Sleep -Milliseconds 600 }
```

要点：
- 用 `Get-NetTCPConnection` 找监听 8090 的 PID，比 `netstat` 解析稳。
- `Get-CimInstance` 拿父进程的 `ParentProcessId / Name / CreationDate`；`CreationDate` 校验避免 PID 复用误杀。
- 父进程是 `cmd.exe` → `taskkill /F /T /PID <父>` 一次性关掉旧窗口和它下面的 node；否则只杀 node。
- 不会误杀当前新开的窗口：当前窗口此时还没启动 node，且被杀的只是「旧 node 的父 cmd」。

### 3.2 改 `start.bat`（Windows，主改）

在 `node server.mjs` 之前调用上面的脚本，并保留 `netstat` 兜底（PowerShell 不可用/漏杀时仍能释放端口）：

```bat
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
  echo   Stopping leftover instance (PID %%a) ...
  taskkill /F /T /PID %%a >nul 2>nul
)
rem 3) 留一点时间给系统释放端口
timeout /t 1 /nobreak >nul
exit /b 0
```

- `netstat` 兜底匹配 `:8090` + `LISTENING`，`tokens=5` 取 PID，覆盖 `127.0.0.1:8090` / `0.0.0.0:8090` / `[::]:8090`。
- 若两个都没命中 → 直接启动，无额外延迟（仅 1s 等待）。

### 3.3 改 `start.command`（macOS，对齐）

macOS 的「终端窗口」由 Terminal.app 管理，脚本无法可靠地自动关窗口；这里只保证**旧进程被杀、端口释放**，窗口由用户自行关闭或在 Terminal 里结束。

```bash
PORT=8090
OLD_PID=$(lsof -ti tcp:"$PORT" 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  echo "检测到上一个服务 (PID $OLD_PID)，正在关闭……"
  kill -9 $OLD_PID 2>/dev/null
  sleep 1
fi
node server.mjs
```

### 3.4 `server.mjs`（兜底提示，低优先）

极端情况（脚本没杀干净）也不裸崩：

```js
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[theoagent-designer] 端口 ${port} 仍被占用：请先关闭占用进程，或换端口启动（node server.mjs 8091）。`);
    process.exit(1);
  }
  throw e;
});
```

## 4. 边界与风险

- **旧窗口**：`taskkill /F /T /PID <父cmd>` 会结束整个控制台及子系统进程，旧黑窗口随之关闭。
- **手动终端启动**：如果上次是手动 `node server.mjs`（父进程不是 `cmd.exe`），只杀 node，不动终端窗口，避免误关用户终端。
- **PID 复用**：用 `CreationDate` 校验父进程创建时间早于 node，降低误杀概率。
- **误杀风险**：只针对「监听 8090」的进程；本项目独占 8090，风险极低。
- **首启无旧实例**：`$listening` 为空 → 无操作，直接启动。
- **过渡期**：升级前用旧版 `start.bat` 起的窗口没有标题、也不在新逻辑覆盖内（但 node 会被 netstat 兜底杀掉，只是那一次窗口可能残留）；升级后再点一次就正常。

## 5. 验证清单

1. 无旧实例 → 直接启动、开浏览器。
2. 服务运行中再点 `start.bat` → 日志显示「node PID ... and its console window (cmd PID ...)」→ 旧窗口关闭、端口释放、新服务正常。
3. 连续点两次 → 每次都先关旧再起新，无端口占用报错。
4. 用 PowerShell 手动起 `node` 占 8090 → 再点 `start.bat`，只杀 node、不关 PowerShell 终端。
5. macOS：`start.command` 同样先杀再起（窗口需手动关）。
6. 首次运行（无 `node_modules`）不受影响。

## 6. 实施步骤

1. 新增 `stop-service.ps1`。
2. 改 `start.bat`：加 `call :stopPrevious` + 兜底子例程。
3. 改 `start.command`：加 `lsof + kill`。
4. 改 `server.mjs`：加 `EADDRINUSE` 友好提示。
5. 更新 `README.md` 的「端口被占用」说明。
6. 本地验证 → 提交并推送 `fix/start-stop-previous-service`，建 PR。
