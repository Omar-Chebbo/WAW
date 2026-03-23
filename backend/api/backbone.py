"""
backend/api/backbone.py
Endpoints for backbone extraction (Step 5).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.backbone_service import extract_backbone, load_backbone_json

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
    return results


@router.get("/{session_id}/{method_id}")
def get_backbone(session_id: str, method_id: str):
    try:
        return load_backbone_json(session_id, method_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
