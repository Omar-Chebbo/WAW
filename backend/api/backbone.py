"""
backend/api/backbone.py
Endpoints for backbone extraction (Step 5) and Step-6 visualization data.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.utils.json_safe import sanitize_for_json
from backend.services.backbone_service import (
    extract_backbone,
    load_backbone_json,
    build_visual_comparison_json,
)

router = APIRouter()


class ExtractRequest(BaseModel):
    session_id: str
    method_ids: list[str]


@router.post("/extract")
def extract(req: ExtractRequest):
    results = {}
    for method_id in req.method_ids:
        try:
            summary = extract_backbone(req.session_id, method_id)
            results[method_id] = summary
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))
        except Exception as e:
            raise HTTPException(500, str(e))
    return sanitize_for_json(results)


@router.get("/{session_id}/{method_id}")
def get_backbone(session_id: str, method_id: str):
    try:
        return sanitize_for_json(load_backbone_json(session_id, method_id))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{session_id}/{method_id}/visual-comparison")
def get_visual_comparison(session_id: str, method_id: str):
    """
    Full unsampled Step-6 graph for one selected method.
    The same graph/positions are used for:
    - score-extreme view: bottom 20% blue, top 20% red
    - IF view: original black, Isolation Forest backbone purple
    """
    try:
        return sanitize_for_json(build_visual_comparison_json(session_id, method_id))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
