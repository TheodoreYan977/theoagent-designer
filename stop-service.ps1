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
exit 0
