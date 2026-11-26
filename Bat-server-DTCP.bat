@echo off
chcp 65001 >nul
rem Bật server DT-CP Online (chế độ CHẠY THẬT - production) trên máy, cổng 3210.
rem Bấm đúp file này; đóng cửa sổ đen = tắt server. Mỗi lần bật sẽ build lại bản mới nhất (khoảng 1-2 phút).
rem Bản dành cho lập trình (hiện lỗi chi tiết): Bat-server-DTCP-dev.bat
cd /d "%~dp0"
title DT-CP Online - server cong 3210

netstat -ano | findstr ":3210" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo Server DT-CP Online dang chay san - mo trinh duyet...
  start "" http://localhost:3210
  timeout /t 3 >nul
  exit /b
)

echo Dang build ban moi nhat cua phan mem (khoang 1-2 phut), vui long cho...
"C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next build
if errorlevel 1 (
  echo.
  echo !!! BUILD LOI - tam chay ban DEV de van dung duoc. Bao lai cho nguoi lap trinh.
  echo.
  start "" cmd /c "timeout /t 15 >nul & start http://localhost:3210"
  "C:\Program Files\nodejs\node.exe" --max-old-space-size=4096 node_modules\next\dist\bin\next dev -p 3210
  pause
  exit /b
)

echo.
echo Dang bat server DT-CP Online...
echo  - May nay:          http://localhost:3210
echo  - May khac cung LAN: http://%COMPUTERNAME%:3210
echo Dong cua so nay de TAT server.
echo.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:3210"
"C:\Program Files\nodejs\node.exe" --max-old-space-size=4096 node_modules\next\dist\bin\next start -p 3210
pause
