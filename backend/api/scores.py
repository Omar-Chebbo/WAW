"""
backend/api/scores.py
Endpoints for score caching, status inspection, and score computation.
"""
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from backend.api.websockets import ws_manager
from backend.config import RAW_DIR, SESSIONS_DIR
from backend.core.methods import METHOD_REGISTRY
from backend.services.score_cache_service import get_cache_status
from backend.services.score_service import compute_scores, load_scores

router = APIRouter()


class ComputeRequest(BaseModel):
    session_id: str
    dataset_id: str
    method_ids: list[str] = Field(default_factory=list)
    is_custom: bool = False
    score_strategy: str = "auto"  # auto | reuse | recompute


class ScoreStatusRequest(BaseModel):
    dataset_id: str
    method_ids: list[str] = Field(default_factory=list)
    is_custom: bool = False



def _resolve_dataset_path(dataset_id: str, is_custom: bool) -> Path:
    if is_custom:
        path = SESSIONS_DIR / "uploads" / f"{dataset_id}.csv"
    else:
        path = RAW_DIR / f"{dataset_id}.csv"

    if not path.exists():
        raise HTTPException(404, f"Dataset file not found: {path}")
    return path


@router.post("/status")
def score_status(req: ScoreStatusRequest):
    unknown = [m for m in req.method_ids if m not in METHOD_REGISTRY]
    if unknown:
        raise HTTPException(400, f"Unknown methods: {unknown}")

    dataset_path = _resolve_dataset_path(req.dataset_id, req.is_custom)
    status = get_cache_status(dataset_path, req.method_ids)
    return {
        "dataset_id": req.dataset_id,
        "is_custom": req.is_custom,
        **status,
    }


@router.post("/compute")
async def trigger_compute(req: ComputeRequest, background_tasks: BackgroundTasks):
    unknown = [m for m in req.method_ids if m not in METHOD_REGISTRY]
    if unknown:
        raise HTTPException(400, f"Unknown methods: {unknown}")

    if req.score_strategy not in {"auto", "reuse", "recompute"}:
        raise HTTPException(400, "score_strategy must be 'auto', 'reuse', or 'recompute'.")

    dataset_path = _resolve_dataset_path(req.dataset_id, req.is_custom)

    background_tasks.add_task(
        compute_scores,
        req.session_id,
        dataset_path,
        req.method_ids,
        ws_manager,
        req.score_strategy,
    )

    return {
        "status": "started",
        "session_id": req.session_id,
        "score_strategy": req.score_strategy,
    }


@router.get("/{session_id}/{method_id}")
def get_scores(session_id: str, method_id: str):
    try:
        df = load_scores(session_id, method_id)
        return df.to_dict(orient="records")
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


@router.get("/{session_id}/{method_id}/exists")
def scores_exist(session_id: str, method_id: str):
    path = SESSIONS_DIR / session_id / "scores" / f"{method_id}.csv"
    return {"exists": path.exists()}
