"""
backend/api/research.py
API for the preprocessing research task, contamination lab experiments,
and the multi-feature anomaly detection study.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.utils.json_safe import sanitize_for_json
from backend.services.research_service import (
    run_benchmark_research,
    run_contamination_study,
    run_multi_feature_study,
    run_iterative_extraction_study,
)

router = APIRouter()


class ResearchRequest(BaseModel):
    network_id: str
    method_id: str
    contamination: float | None = None


class ContaminationExperimentRequest(BaseModel):
    dataset_id: str
    method_id: str
    contamination_values: list[str] = Field(default_factory=list)
    preprocessing_mode: str | None = "none"
    score_source: str = "auto"
    session_id: str | None = None
    is_custom: bool = False


class IterativeExtractionRequest(BaseModel):
    dataset_id: str
    method_ids: list[str] = Field(default_factory=lambda: ["pa"])
    target_percent: float = 20.0
    stage_percents: list[float] = Field(default_factory=lambda: [10.0, 10.0])
    low_region_percent: float = 10.0
    high_region_percent: float = 10.0
    score_source: str = "auto"
    session_id: str | None = None
    is_custom: bool = False


class MultiFeatureExperimentRequest(BaseModel):
    dataset_id: str
    contamination: float | None = None
    score_source: str = "auto"
    session_id: str | None = None
    is_custom: bool = False
    scaling_mode: str = "none"


@router.post("/run")
def run_research(req: ResearchRequest):
    try:
        return sanitize_for_json(run_benchmark_research(req.network_id, req.method_id, req.contamination))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/contamination")
def run_contamination(req: ContaminationExperimentRequest):
    try:
        return sanitize_for_json(run_contamination_study(
            dataset_id=req.dataset_id,
            method_id=req.method_id,
            contamination_values=req.contamination_values,
            preprocessing_mode=req.preprocessing_mode,
            score_source=req.score_source,
            session_id=req.session_id,
            is_custom=req.is_custom,
        ))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/multi-feature")
def run_multi_feature(req: MultiFeatureExperimentRequest):
    try:
        return sanitize_for_json(run_multi_feature_study(
            dataset_id=req.dataset_id,
            contamination=req.contamination,
            score_source=req.score_source,
            session_id=req.session_id,
            is_custom=req.is_custom,
            scaling_mode=req.scaling_mode,
        ))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/iterative-extraction")
def run_iterative_extraction(req: IterativeExtractionRequest):
    try:
        return sanitize_for_json(run_iterative_extraction_study(
            dataset_id=req.dataset_id,
            method_ids=req.method_ids,
            target_percent=req.target_percent,
            stage_percents=req.stage_percents,
            low_region_percent=req.low_region_percent,
            high_region_percent=req.high_region_percent,
            score_source=req.score_source,
            session_id=req.session_id,
            is_custom=req.is_custom,
        ))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
