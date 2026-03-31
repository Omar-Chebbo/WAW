"""
backend/api/research.py
API for the preprocessing research task.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.research_service import run_benchmark_research

router = APIRouter()


class ResearchRequest(BaseModel):
    network_id: str
    method_id: str


@router.post("/run")
def run_research(req: ResearchRequest):
    try:
        return run_benchmark_research(req.network_id, req.method_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))