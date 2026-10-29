@echo off
setlocal
cd /d "%~dp0"
echo Network Backbone Explorer - Contamination Lab extended

echo Building the current React interface so an older frontend is never served...
where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js / npm is not installed. Install Node.js 18+ first.
    pause
    exit /b 1
)
cd frontend
if not exist "node_modules\.bin\vite.cmd" (
    echo First run: installing frontend dependencies...
    call npm ci
    if errorlevel 1 goto :build_error
)
call npm run build
if errorlevel 1 goto :build_error
cd ..
echo.
echo Starting at http://localhost:8000
where uv >nul 2>nul
if not errorlevel 1 (
    uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
) else (
    py -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
)
pause
exit /b 0
:build_error
echo.
echo ERROR: Frontend build failed. Check npm/network access and try again.
pause
exit /b 1
