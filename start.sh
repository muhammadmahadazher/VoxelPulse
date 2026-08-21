#!/usr/bin/env bash
# VoxelPulse one-click launcher (macOS / Linux)
set -e
cd "$(dirname "$0")"

echo "[VoxelPulse] Backend..."
(cd backend && python3 -m pip install -q -r requirements.txt && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000) &
BACK_PID=$!

echo "[VoxelPulse] Frontend..."
(cd frontend && npm install && npm run dev) &
FRONT_PID=$!

trap "kill $BACK_PID $FRONT_PID 2>/dev/null" EXIT
sleep 4
echo "[VoxelPulse] Dashboard: http://localhost:5173"
wait
