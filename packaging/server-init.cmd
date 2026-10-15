@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 서버에 공식 Node.js 24를 먼저 설치하세요.
  pause
  exit /b 1
)
echo 서버가 없으면 주소를 비워 두고 Enter를 누르면 이 PC의 관리 화면을 검토할 수 있습니다.
set /p license_public_url=공개 HTTPS 인증 서버 주소 또는 로컬 검토 Enter:
if not defined license_public_url set license_public_url=http://127.0.0.1:4380
node server.cjs init --url "%license_public_url%" --data "%~dp0license-data"
pause
