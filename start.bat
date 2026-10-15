@echo off
echo ========================================================
echo        TimeOn - WFH Team Status & Pulse
echo ========================================================
echo.
echo Starting TimeOn server on http://localhost:3005 ...
start http://localhost:3005
node server.js
pause
