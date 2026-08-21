@echo off
REM VoxelPulse one-click launcher (Windows)
setlocal
cd /d "%~dp0"

echo [VoxelPulse] Starting backend...
start "VoxelPulse Backend" cmd /k "cd backend && python -m pip install -q -r requirements.txt && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [VoxelPulse] Starting frontend...
start "VoxelPulse Frontend" cmd /k "cd frontend && call npm install && npm run dev"

timeout /t 5 >nul
start http://localhost:5173
echo [VoxelPulse] Dashboard: http://localhost:5173
endlocal
