@echo off
cd /d "%~dp0"
echo.
echo ========================================
echo   项目档案管理器 v2.5.0
echo ========================================
echo.
echo [1] 网页版（浏览器打开）
echo [2] 桌面版（独立窗口）
echo.
choice /c 12 /n /m "请选择 [1/2]: "
if errorlevel 2 goto desktop
if errorlevel 1 goto web

:web
echo.
echo   启动中，浏览器将自动打开...
start "" "http://localhost:37890"
node server.js
goto end

:desktop
echo.
echo   启动桌面版...
npx electron .
goto end

:end
