@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 서버에 공식 Node.js 24를 먼저 설치하세요.
  pause
  exit /b 1
)
set /p license_public_url=공개 HTTPS 인증 서버 주소를 입력하세요: 
node server.cjs init --url "%license_public_url%" --data "%~dp0license-data"
pause
