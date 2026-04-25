"""
backend/main.py
FastAPI application entry point.
Run with:  uvicorn backend.main:app --reload --port 8000
"""
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.api import datasets, scores, anomalies, backbone, evaluation, research, exports
from backend.api.websockets import router as ws_router

# ── Logging setup ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ── App ────────────────────────────────────────────────────────────
app = FastAPI(
    title="Network Backbone Explorer",
    description="Interactive dashboard for backbone extraction and evaluation.",
    version="1.0.0",
)

# Allow the Vite dev server (port 5173) to call us during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────
app.include_router(datasets.router,   prefix="/api/datasets",   tags=["datasets"])
app.include_router(scores.router,     prefix="/api/scores",     tags=["scores"])
app.include_router(anomalies.router,  prefix="/api/anomalies",  tags=["anomalies"])
app.include_router(backbone.router,   prefix="/api/backbone",   tags=["backbone"])
app.include_router(evaluation.router, prefix="/api/evaluation", tags=["evaluation"])
app.include_router(ws_router)          # WebSocket at /ws/{session_id}
app.include_router(research.router,   prefix="/api/research",   tags=["research"])
app.include_router(exports.router,    prefix="/api/exports",    tags=["exports"])

# ── Serve built React frontend in production ───────────────────────
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

logger.info("Network Backbone Explorer API ready.")
