"""
Central configuration — all paths and constants live here.
If you move the project folder, only change ROOT_DIR.
"""
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────
ROOT_DIR     = Path(__file__).parent.parent          # WAW2025/
DATA_DIR     = ROOT_DIR / "data"
RAW_DIR      = DATA_DIR / "raw"                      # pre-loaded datasets
SESSIONS_DIR = DATA_DIR / "sessions"                 # per-session working data
LABELED_DIR  = DATA_DIR / "labeled"                  # legacy reference data
CACHE_DIR    = DATA_DIR / "cache"                    # reusable dataset-level artifacts
SCORE_CACHE_DIR = CACHE_DIR / "scores"               # reusable PA / LP / PA+LP score cache
SCORE_CACHE_VERSION = "v1"                           # bump when score logic changes

# Make sure required folders exist when the app starts
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
SCORE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ── Graph display limits ───────────────────────────────────────────
MAX_PREVIEW_EDGES = 400   # edges shown in the Step-1 mini preview
MAX_CANVAS_EDGES  = 1500  # edges shown in the full comparison canvas

# ── Available backbone methods ─────────────────────────────────────
# This list drives the Method Selection step (Step 2).
# To add a new method later: add it to backend/core/methods.py and
# add an entry here — nothing else needs to change.
AVAILABLE_METHODS = ["hss", "df", "pa", "lp", "pa_lp"]
