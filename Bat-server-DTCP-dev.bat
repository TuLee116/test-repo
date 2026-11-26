@echo off
chcp 65001 >nul
rem Bật server DT-CP Online trên máy (cổng 3210). Bấm đúp file này; đóng cửa sổ đen = tắt server.
cd /d "%~dp0"
title DT-CP Online - server cong 3210 (ban DEV de lap trinh)

netstat -ano | findstr ":3210" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo Server DT-CP Online dang chay san - mo trinh duyet...
  start "" http://localhost:3210
  timeout /t 3 >nul
  exit /b
)

echo Dang bat server DT-CP Online...
echo  - May nay:          http://localhost:3210
echo  - May khac cung LAN: http://%COMPUTERNAME%:3210
echo Dong cua so nay de TAT server.
echo.
start "" cmd /c "timeout /t 10 >nul & start http://localhost:3210"
"C:\Program Files\nodejs\node.exe" --max-old-space-size=4096 node_modules\next\dist\bin\next dev -p 3210
pause
