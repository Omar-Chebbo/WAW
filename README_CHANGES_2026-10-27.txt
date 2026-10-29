NETWORK BACKBONE EXPLORER — VERIFIED FRONTEND PATCH (2026-10-27)

IMPORTANT: This ZIP INCLUDES THE UPDATED PREBUILT FRONTEND in backend/static.
DO NOT run npm install or npm run build just to view these changes: a fresh build
from source can be done on your machine but is not required to start the app.

INSTALLATION / LAUNCH:
1. Stop any previous uvicorn and/or npm dev server.
2. Extract this ZIP into a NEW, EMPTY folder. Do not merge it with an old copy.
3. Open a terminal inside the extracted project/ folder.
4. Run: uv run uvicorn backend.main:app --port 8000
   (or your usual Python environment's: python -m uvicorn backend.main:app --port 8000)
5. Open http://localhost:8000 and hard-refresh once (Ctrl+Shift+R).
   If running `npm run dev` instead, start it FROM THIS ZIP's frontend/ folder.

VERIFICATION:
- View page source at http://localhost:8000 and confirm script name
  index-CorrectedFrontend-v3.js
- Experiment Lab / Multi Feature / Individual vs Multi-Feature comparison
  should say 'Original negative Isolation Forest scores' and show NEGATIVE axes.
- Downloaded PA/LP scatter figures should have NEGATIVE axes and the most
  anomalous points should be below the dashed selection cutoff.
- Downloaded PNG heatmap should show centered two-line region headings
  and a visible 'Selection rate' vertical legend with 0–100% ticks on the right.

METHODOLOGY: LP epsilon remains 1 (named alpha in backend/core/methods.py).
No LP formula or anomaly ranking algorithm was modified.
