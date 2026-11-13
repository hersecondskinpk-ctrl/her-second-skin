@echo off
setlocal
cd /d "%~dp0"
echo Please STOP the Her Second Skin server window before backing up the database.
pause
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set stamp=%%i
set dest=backups\%stamp%
mkdir "%dest%" 2>nul
if exist "data\her-second-skin.sqlite" copy /y "data\her-second-skin.sqlite" "%dest%\her-second-skin.sqlite" >nul
if exist uploads xcopy "uploads\*" "%dest%\uploads\" /E /I /Y >nul
if exist "data\INITIAL-ADMIN-LOGIN.txt" copy /y "data\INITIAL-ADMIN-LOGIN.txt" "%dest%\INITIAL-ADMIN-LOGIN.txt" >nul
echo Backup saved to %dest%
pause
