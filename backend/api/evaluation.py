"""
backend/api/evaluation.py
Endpoints for running and exporting evaluation metrics (Step 7).
"""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from backend.utils.json_safe import sanitize_for_json
from backend.services.evaluation_service import (
    run_evaluation,
    load_evaluation,
    evaluation_to_csv,
    run_distributions,
)
from backend.core.evaluation import METRIC_REGISTRY
from backend.config import RAW_DIR, SESSIONS_DIR

router = APIRouter()


class EvalRequest(BaseModel):
    session_id:  str
    dataset_id:  str
    method_ids:  list[str]
    metric_ids:  list[str]
    is_custom:   bool = False


@router.get("/metrics")
def list_metrics():
    return sanitize_for_json([
        {"id": mid, "label": entry["label"]}
        for mid, entry in METRIC_REGISTRY.items()
    ])


@router.post("/run")
def run(req: EvalRequest):
    if req.is_custom:
        dataset_path = SESSIONS_DIR / "uploads" / f"{req.dataset_id}.csv"
    else:
        dataset_path = RAW_DIR / f"{req.dataset_id}.csv"

    if not dataset_path.exists():
        raise HTTPException(404, "Dataset not found")

    try:
        report = run_evaluation(
            req.session_id, dataset_path, req.method_ids, req.metric_ids
        )
        return sanitize_for_json(report)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{session_id}")
def get_evaluation(session_id: str):
    try:
        return sanitize_for_json(load_evaluation(session_id))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{session_id}/export/csv")
def export_csv(session_id: str):
    try:
        csv_text = evaluation_to_csv(session_id)
        return PlainTextResponse(
            csv_text,
            headers={"Content-Disposition": "attachment; filename=evaluation_results.csv"},
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{session_id}/distributions")
def get_distributions(
    session_id: str,
    dataset_id: str,
    method_ids: str,
    is_custom: bool = False,
):
    method_list = [m.strip() for m in method_ids.split(",") if m.strip()]

    if is_custom:
        dataset_path = SESSIONS_DIR / "uploads" / f"{dataset_id}.csv"
    else:
        dataset_path = RAW_DIR / f"{dataset_id}.csv"

    if not dataset_path.exists():
        raise HTTPException(404, "Dataset not found")

    try:
        return sanitize_for_json(run_distributions(session_id, dataset_path, method_list))
    except Exception as e:
        raise HTTPException(500, str(e))
