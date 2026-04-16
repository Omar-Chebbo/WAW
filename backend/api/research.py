"""
backend/api/research.py
API for the preprocessing research task, contamination lab experiments,
and the multi-feature anomaly detection study.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.research_service import (
    run_benchmark_research,
    run_contamination_study,
    run_multi_feature_study,
)

router = APIRouter()


class ResearchRequest(BaseModel):
    network_id: str
    method_id: str


class ContaminationExperimentRequest(BaseModel):
    dataset_id: str
    method_id: str
    contamination_values: list[str] = Field(default_factory=list)
    preprocessing_mode: str | None = "none"
    score_source: str = "compute_fresh"
    session_id: str | None = None
    is_custom: bool = False


class MultiFeatureExperimentRequest(BaseModel):
    dataset_id: str
    contamination: float | None = None
    score_source: str = "compute_fresh"
    session_id: str | None = None
    is_custom: bool = False
    scaling_mode: str = "none"


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


@router.post("/contamination")
def run_contamination(req: ContaminationExperimentRequest):
    try:
        return run_contamination_study(
            dataset_id=req.dataset_id,
            method_id=req.method_id,
            contamination_values=req.contamination_values,
            preprocessing_mode=req.preprocessing_mode,
            score_source=req.score_source,
            session_id=req.session_id,
            is_custom=req.is_custom,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/multi-feature")
def run_multi_feature(req: MultiFeatureExperimentRequest):
    try:
        return run_multi_feature_study(
            dataset_id=req.dataset_id,
            contamination=req.contamination,
            score_source=req.score_source,
            session_id=req.session_id,
            is_custom=req.is_custom,
            scaling_mode=req.scaling_mode,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
