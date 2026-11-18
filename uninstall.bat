@echo off
setlocal
title TheoAgent Designer - Uninstall

rem Re-launch from a TEMP copy so this script is not locked while deleting its own folder.
if /I "%~1"=="--go" goto doRemove

copy /y "%~f0" "%TEMP%\theoagent-uninstall-run.bat" >nul
if errorlevel 1 (
  echo Failed to copy the uninstall script to TEMP. Please run again.
  pause
  exit /b 1
)
call "%TEMP%\theoagent-uninstall-run.bat" --go "%~dp0"
del "%TEMP%\theoagent-uninstall-run.bat" >nul 2>nul
exit /b

:doRemove
set "PROJ=%~2"
if "%PROJ:~-1%"=="\" set "PROJ=%PROJ:~0,-1%"

echo ============================================================
echo  WARNING: This will DELETE the whole project folder:
echo    %PROJ%
echo  (template.json / sample.json / uploads / output /
echo   templates / node_modules ... all removed, cannot be undone)
echo ============================================================
echo.
set /p CONFIRM=Type YES to confirm (anything else cancels): 
if /I not "%CONFIRM%"=="YES" (
  echo Cancelled.
  pause
  exit /b 0
)

echo.
echo Stopping local server on port 8090 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:8090" ^| findstr "LISTENING"') do (
  echo   kill PID %%a
  taskkill /F /PID %%a >nul 2>nul
)

cd /d "%~2" 2>nul
cd .. 2>nul
echo.
echo Deleting: %PROJ%
rmdir /s /q "%PROJ%"

if exist "%PROJ%" (
  echo.
  echo FAILED: some files are locked. Close all related windows and retry.
  pause
  exit /b 1
)

echo.
echo Done. The project has been removed.
echo You can close this window.
pause
