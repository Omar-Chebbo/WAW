Network Backbone Explorer — Install into your EXISTING app folder

WHY THIS PATCH: Compiling an older app folder or running an old server on 5173/8000 can show the original UI even when new source files exist elsewhere.

1. STOP all previous npm dev servers and FastAPI/uvicorn instances (Ctrl+C).
2. Open the folder where your ORIGINAL app lives. It must contain both "frontend" and "backend".
   Example: C:\Users\user\Desktop\Master 2- Data Science\Sem 2\app
3. EXTRACT ALL files from this ZIP DIRECTLY INTO that app folder (not into a new nested folder).
   You should see "app\APPLY_UPDATE.bat" and "app\_contamination_patch_files\...".
4. DOUBLE CLICK APPLY_UPDATE.bat in that app folder. It backs up modified files and rebuilds the actual app backend/static.
5. Ensure it prints SUCCESS; it explicitly searches the built JavaScript for the new novelty section.
6. Start FastAPI from that SAME app folder, for example:
      uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
7. Visit http://127.0.0.1:8000 (not old localhost:5173), Ctrl+Shift+R.
8. In Experiment Lab > Contamination, title now says "Enhanced Excel + Novelty".
   Select PA+LP and click Run experiment to populate the two XLSX export tables.

If you prefer to run the script from another location, use PowerShell:
   powershell -ExecutionPolicy Bypass -File .\APPLY_UPDATE.ps1 -ProjectRoot "C:\...\app"

Modified files are saved under .contamination_patch_backups before overwriting.
Build depends on your existing node_modules or a working npm registry connection.
