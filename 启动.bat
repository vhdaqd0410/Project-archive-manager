@echo off
cd /d "%~dp0"
start "" "http://localhost:37890"
node server.js
pause
