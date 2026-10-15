@echo off
title Install TimeOn Tunnel Service
echo ========================================================
echo Installing Cloudflare Tunnel as a Windows Service...
echo ========================================================
if not exist "%USERPROFILE%\.cloudflared" mkdir "%USERPROFILE%\.cloudflared"
copy /y "%~dp06e9c92af-91d7-4b69-b819-cfd7a2f95971.json" "%USERPROFILE%\.cloudflared\"
copy /y "%~dp0config.yml" "%USERPROFILE%\.cloudflared\"
copy /y "%~dp0cert.pem" "%USERPROFILE%\.cloudflared\"
cloudflared service install
echo.
echo Done! Cloudflare Tunnel service is installed and will run automatically on Windows boot.
pause
