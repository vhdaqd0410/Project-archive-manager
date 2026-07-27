@echo off
cd /d "%~dp0"
cscript //NoLogo //B launch.vbs
timeout /t 3 /nobreak >nul
start "" "http://localhost:37890"
