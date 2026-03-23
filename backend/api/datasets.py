"""
backend/api/datasets.py
REST endpoints for listing pre-loaded datasets and uploading custom ones.
"""
import shutil
import uuid
import logging
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from backend.config import RAW_DIR, SESSIONS_DIR
from backend.services.graph_service import load_graph, graph_stats, graph_to_json
from backend.config import MAX_PREVIEW_EDGES

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
def list_datasets():
    """Return the list of pre-loaded datasets in data/raw/."""
    datasets = []
    for f in sorted(RAW_DIR.glob("*.csv")):
        try:
            G     = load_graph(f)
            stats = graph_stats(G)
        except Exception as e:
            stats = {"error": str(e)}

        datasets.append({
            "id":        f.stem,
            "filename":  f.name,
            "path":      str(f),
            "stats":     stats,
        })
    return datasets


@router.get("/{dataset_id}/stats")
def get_stats(dataset_id: str):
    """Return full stats for one pre-loaded dataset."""
    path = RAW_DIR / f"{dataset_id}.csv"
    if not path.exists():
        # Also check custom uploads in sessions
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")
    G = load_graph(path)
    return graph_stats(G)


@router.get("/{dataset_id}/preview")
def get_preview(dataset_id: str):
    """Return a downsampled D3 node-link JSON for the graph preview."""
    path = RAW_DIR / f"{dataset_id}.csv"
    if not path.exists():
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")
    G    = load_graph(path)
    data = graph_to_json(G, max_edges=MAX_PREVIEW_EDGES)
    return data


@router.post("/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """
    Accept a custom CSV edge-list upload.
    Saves it and returns a dataset_id the frontend can use in all subsequent calls.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are accepted.")

    # Give this upload a stable ID
    dataset_id = f"custom_{uuid.uuid4().hex[:8]}"
    upload_dir = SESSIONS_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    save_path  = upload_dir / f"{dataset_id}.csv"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Validate it can be loaded as a graph
    try:
        G     = load_graph(save_path)
        stats = graph_stats(G)
    except Exception as e:
        save_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not parse CSV: {e}")

    return {
        "dataset_id": dataset_id,
        "filename":   file.filename,
        "path":       str(save_path),
        "stats":      stats,
    }


@router.get("/custom/{dataset_id}/preview")
def get_custom_preview(dataset_id: str):
    """Preview for a user-uploaded dataset."""
    path = SESSIONS_DIR / "uploads" / f"{dataset_id}.csv"
    if not path.exists():
        raise HTTPException(404, "Custom dataset not found")
    G    = load_graph(path)
    data = graph_to_json(G, max_edges=MAX_PREVIEW_EDGES)
    return data


@router.get("/custom/{dataset_id}/stats")
def get_custom_stats(dataset_id: str):
    path = SESSIONS_DIR / "uploads" / f"{dataset_id}.csv"
    if not path.exists():
        raise HTTPException(404, "Custom dataset not found")
    G = load_graph(path)
    return graph_stats(G)
