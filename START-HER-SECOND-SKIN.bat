@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo  Her Second Skin PK - Store and Inventory Server
echo ================================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  echo Install a recent Node.js 22+ version, then reopen this file.
  pause
  exit /b 1
)
echo Checking Node.js version...
node --version
echo.
echo This window must remain open while you use the website.
echo Admin login: data\INITIAL-ADMIN-LOGIN.txt (first run only)
echo Store: http://127.0.0.1:8787/
echo Admin: http://127.0.0.1:8787/admin
echo.
start "" /B cmd /c "ping 127.0.0.1 -n 3 >nul & start http://127.0.0.1:8787/"
node server.js
pause
