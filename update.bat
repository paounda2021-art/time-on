@echo off
chcp 65001 >nul
echo ====================================================
echo  TimeOn - Auto Backup ^& Git Pull Update
echo ====================================================

REM 1. Backup existing database and files first
node scripts/backup.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Backup failed! Update aborted to protect data.
    exit /b %ERRORLEVEL%
)

echo.
echo Pulling latest code from GitHub...
git pull origin main
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Git pull failed!
    exit /b %ERRORLEVEL%
)

echo.
echo Restarting PM2 process...
pm2 restart time-on

echo.
echo ====================================================
echo  Update and Restart Completed Successfully!
echo ====================================================
