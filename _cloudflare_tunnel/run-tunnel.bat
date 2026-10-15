@echo off
title TimeOn Cloudflare Tunnel
echo ========================================================
echo Starting Cloudflare Tunnel for timeon.fishmarket.co.th...
echo ========================================================
cloudflared tunnel --config "%~dp0config.yml" run timeon-tunnel
pause
