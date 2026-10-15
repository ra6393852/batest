@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.cjs start --data "%~dp0license-data" --port 4380
pause
