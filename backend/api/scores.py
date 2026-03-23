"""
backend/api/scores.py
Endpoint to trigger score computation (runs in background,
streams progress over WebSocket).
"""
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from backend.api.websockets import ws_manager
from backend.services.score_service import compute_scores, load_scores
from backend.core.methods import METHOD_REGISTRY
from backend.config import RAW_DIR, SESSIONS_DIR

logger = logging.getLogger(__name__)
router = APIRouter()


class ComputeRequest(BaseModel):
    session_id:  str
    dataset_id:  str
    method_ids:  list[str]
    is_custom:   bool = False   # True when the dataset was uploaded by the user


def _resolve_dataset_path(dataset_id: str, is_custom: bool) -> Path:
    """Find the CSV path for a dataset, whether pre-loaded or custom."""
    if is_custom:
        path = SESSIONS_DIR / "uploads" / f"{dataset_id}.csv"
    else:
        path = RAW_DIR / f"{dataset_id}.csv"

    if not path.exists():
        raise HTTPException(404, f"Dataset file not found: {path}")
    return path


@router.post("/compute")
async def trigger_compute(req: ComputeRequest, background_tasks: BackgroundTasks):
    """
    Kick off score computation as a background task.
    Progress is streamed to the frontend via WebSocket.
    """
    # Validate method IDs
    unknown = [m for m in req.method_ids if m not in METHOD_REGISTRY]
    if unknown:
        raise HTTPException(400, f"Unknown methods: {unknown}")

    dataset_path = _resolve_dataset_path(req.dataset_id, req.is_custom)

    # Run in the background so this endpoint returns immediately
    background_tasks.add_task(
        compute_scores,
        req.session_id,
        dataset_path,
        req.method_ids,
        ws_manager,
    )

    return {"status": "started", "session_id": req.session_id}


@router.get("/{session_id}/{method_id}")
def get_scores(session_id: str, method_id: str):
    """Return computed edge scores for one method as a JSON list."""
    try:
        df = load_scores(session_id, method_id)
        return df.to_dict(orient="records")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{session_id}/{method_id}/exists")
def scores_exist(session_id: str, method_id: str):
    """Quick check — does a score file already exist for this session + method?"""
    path = SESSIONS_DIR / session_id / "scores" / f"{method_id}.csv"
    return {"exists": path.exists()}
