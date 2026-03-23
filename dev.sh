#!/bin/bash
# dev.sh  —  starts backend and frontend in parallel for development
# Both servers have hot-reload.  Frontend is at http://localhost:5173
# Usage:  bash dev.sh

echo ""
echo "🔧 Starting in DEVELOPMENT mode"
echo "   Backend  →  http://localhost:8000"
echo "   Frontend →  http://localhost:5173"
echo "   (Both servers have hot-reload)"
echo ""

# Install Python deps if needed
pip install fastapi "uvicorn[standard]" python-multipart aiofiles websockets \
  networkx pandas numpy scikit-learn scipy joblib tqdm 2>/dev/null

# Install npm deps if needed
(cd frontend && npm install --silent)

# Run both servers in parallel
(uvicorn backend.main:app --reload --port 8000) &
BACKEND_PID=$!

(cd frontend && npm run dev) &
FRONTEND_PID=$!

# Clean up both processes on Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
