# TimeOn Safe Auto-Backup & Git Pull Update Script
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " TimeOn - Auto Backup & Git Pull Update" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Backup existing database and files first
node scripts/backup.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Backup failed! Update aborted to protect data." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 2. Git Pull latest code
Write-Host "`nPulling latest code from GitHub..." -ForegroundColor Yellow
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Git pull failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3. Restart PM2 process
Write-Host "`nRestarting PM2 process..." -ForegroundColor Yellow
pm2 restart time-on

Write-Host "`n====================================================" -ForegroundColor Green
Write-Host " Update and Restart Completed Successfully!" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
