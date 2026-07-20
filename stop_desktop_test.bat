@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-desktop-test.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if not defined QIGOU_NO_PAUSE pause
exit /b %EXIT_CODE%
