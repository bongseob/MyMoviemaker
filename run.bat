@echo off
echo ==========================================
echo   MyMoviemaker 개발 모드 실행 중...
echo ==========================================

:: Vite 개발 서버를 백그라운드에서 실행 (새 창으로 띄우기)
echo 1. Vite 개발 서버 시작...
start /min cmd /c "npm run dev"

:: Electron 앱 실행 (wait-on이 Vite 서버가 준비될 때까지 대기함)
echo 2. Electron 앱 실행 대기 중...
npm run electron:dev

echo.
echo 앱이 종료되었습니다.
pause
