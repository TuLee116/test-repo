@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DT-CP Online - chay online

echo ============================================================
echo  DT-CP Online - dua len mang bang Cloudflare Tunnel
echo  Giu cua so nay MO trong luc moi nguoi dung thu.
echo  Dong cua so nay = ngung chia se.
echo ============================================================
echo.

echo [1/3] Dang build ban chay that (khoang 1-3 phut)...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo BUILD LOI - xem thong bao phia tren.
  pause
  exit /b 1
)

echo.
echo [2/3] Khoi dong server o cong 3300...
set AUTH_TRUST_HOST=true
start "DTCP Server (cong 3300)" cmd /k "set AUTH_TRUST_HOST=true && npm.cmd start -- -p 3300"
timeout /t 10 >nul

echo.
echo [3/3] Tao link cong khai. Tim dong co chu trycloudflare.com ben duoi va gui cho moi nguoi.
echo (Truoc khi gui: nho DOI MAT KHAU ADMIN trong muc "Nguoi dung".)
echo.
set CF=cloudflared
where cloudflared >nul 2>nul || set CF="C:\Program Files (x86)\cloudflared\cloudflared.exe"
%CF% tunnel --url http://localhost:3300
pause
