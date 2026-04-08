"""
backend/api/anomalies.py
Endpoints for running and adjusting anomaly labeling (Step 4).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.anomaly_service import (
    run_anomaly_labeling,
    run_manual_labeling,
    load_labeled,
    get_score_distribution,
    get_anomaly_inspector,
)

router = APIRouter()


class LabelRequest(BaseModel):
    session_id: str
    method_id: str
    preprocessing_mode: str | None = None
    contamination: float | None = None


class RelabelRequest(BaseModel):
    session_id: str
    method_id: str
    percentile: float   # 0-100


@router.post("/label")
def label(req: LabelRequest):
    try:
        summary = run_anomaly_labeling(
            req.session_id,
            req.method_id,
            req.preprocessing_mode,
            req.contamination,
        )
        return {"status": "ok", "summary": summary}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/relabel")
def relabel(req: RelabelRequest):
    try:
        summary = run_manual_labeling(req.session_id, req.method_id, req.percentile)
        return {"status": "ok", "summary": summary}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/{session_id}/{method_id}")
def get_labeled(session_id: str, method_id: str):
    try:
        df = load_labeled(session_id, method_id)
        return df.to_dict(orient="records")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{session_id}/{method_id}/distribution")
def get_distribution(session_id: str, method_id: str):
    return get_score_distribution(session_id, method_id)


@router.get("/{session_id}/{method_id}/inspector")
def get_inspector(session_id: str, method_id: str):
    try:
        return get_anomaly_inspector(session_id, method_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))