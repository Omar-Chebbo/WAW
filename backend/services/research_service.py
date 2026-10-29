"""
backend/services/research_service.py
Service layer for the preprocessing research task, contamination lab,
and the multi-feature anomaly detection study.
"""
from __future__ import annotations

from pathlib import Path

import networkx as nx
import pandas as pd

from backend.config import RAW_DIR, SESSIONS_DIR
from backend.core.anomaly import normalize_selection_fraction
from backend.core.contamination_analysis import run_contamination_experiment
from backend.core.methods import METHOD_REGISTRY
from backend.core.multi_feature_analysis import run_multi_feature_experiment
from backend.core.iterative_extraction_analysis import run_iterative_extraction_experiment
from backend.core.research_analysis import run_research_analysis
from backend.services.graph_service import graph_to_json, load_graph
from backend.services.score_cache_service import (
    PA_COLUMN,
    LP_COLUMN,
    get_or_compute_score_dataframe,
    merge_pa_lp_scores,
)
from backend.services.score_service import load_scores


BENCHMARK_DATASETS = {
    "karate": {
        "filename": "karate_club_network.csv",
        "label": "Zachary's Karate Club",
    },
    "lesmis": {
        "filename": "lesmis.csv",
        "label": "Les Misérables",
    },
}



def _resolve_benchmark_path(network_id: str) -> tuple[Path, str]:
    if network_id not in BENCHMARK_DATASETS:
        raise ValueError(
            f"Unknown benchmark network '{network_id}'. Use one of: {list(BENCHMARK_DATASETS)}"
        )

    meta = BENCHMARK_DATASETS[network_id]
    path = RAW_DIR / meta["filename"]

    if not path.exists():
        raise FileNotFoundError(f"Benchmark dataset not found: {path}")

    return path, meta["label"]



def resolve_dataset_path(dataset_id: str, is_custom: bool = False) -> tuple[Path, str]:
    if is_custom:
        path = SESSIONS_DIR / "uploads" / f"{dataset_id}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Custom dataset not found: {dataset_id}")
        return path, path.stem

    path = RAW_DIR / f"{dataset_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_id}")
    return path, path.stem



def build_scored_dataframe(
    dataset_path: Path,
    method_id: str,
    score_source: str = "auto",
    session_id: str | None = None,
):
    if method_id not in {"pa", "lp"}:
        raise ValueError("This research endpoint supports only 'pa' and 'lp'.")

    if score_source == "session_scores":
        if not session_id:
            raise ValueError("session_id is required when score_source='session_scores'.")
        scored_df = load_scores(session_id, method_id)
        return scored_df, "session_scores"

    if score_source not in {"auto", "reuse", "recompute"}:
        raise ValueError("score_source must be 'auto', 'reuse', 'recompute', or 'session_scores'.")

    effective_strategy = "auto" if score_source == "reuse" else score_source
    scored_df, source_kind = get_or_compute_score_dataframe(
        dataset_path=dataset_path,
        method_id=method_id,
        strategy=effective_strategy,
    )
    return scored_df, source_kind



def build_combined_scored_dataframe(
    dataset_path: Path,
    score_source: str = "auto",
    session_id: str | None = None,
) -> tuple[pd.DataFrame, str]:
    if score_source == "session_scores":
        if not session_id:
            raise ValueError("session_id is required when score_source='session_scores'.")
        try:
            combined_df = load_scores(session_id, "pa_lp")
            if PA_COLUMN in combined_df.columns and LP_COLUMN in combined_df.columns:
                return combined_df, "session_scores"
        except FileNotFoundError:
            pass
        pa_df = load_scores(session_id, "pa")
        lp_df = load_scores(session_id, "lp")
        return merge_pa_lp_scores(pa_df, lp_df), "session_scores"

    if score_source not in {"auto", "reuse", "recompute"}:
        raise ValueError("score_source must be 'auto', 'reuse', 'recompute', or 'session_scores'.")

    effective_strategy = "auto" if score_source == "reuse" else score_source
    combined_df, source_kind = get_or_compute_score_dataframe(
        dataset_path=dataset_path,
        method_id="pa_lp",
        strategy=effective_strategy,
    )
    return combined_df, source_kind



def run_benchmark_research(network_id: str, method_id: str, contamination: float | str | None = None) -> dict:
    dataset_path, network_label = _resolve_benchmark_path(network_id)
    G = load_graph(dataset_path)

    config = METHOD_REGISTRY[method_id]
    scored_graph = config["function"](G.copy(), **config.get("kwargs", {}))
    scored_df = nx.to_pandas_edgelist(scored_graph)

    score_column = config["score_column"]

    return run_research_analysis(
        G=G,
        scored_df=scored_df,
        method_id=method_id,
        score_column=score_column,
        network_label=network_label,
        contamination=contamination,
    )



def run_contamination_study(
    dataset_id: str,
    method_id: str,
    contamination_values: list[str],
    preprocessing_mode: str | None = None,
    score_source: str = "auto",
    session_id: str | None = None,
    is_custom: bool = False,
) -> dict:
    dataset_path, dataset_label = resolve_dataset_path(dataset_id, is_custom=is_custom)
    original_graph = load_graph(dataset_path)
    if method_id == "pa_lp":
        scored_df, resolved_source = build_combined_scored_dataframe(
            dataset_path=dataset_path,
            score_source=score_source,
            session_id=session_id,
        )
    else:
        scored_df, resolved_source = build_scored_dataframe(
            dataset_path=dataset_path,
            method_id=method_id,
            score_source=score_source,
            session_id=session_id,
        )

    result = run_contamination_experiment(
        original_graph=original_graph,
        scored_df=scored_df,
        method_id=method_id,
        contamination_values=contamination_values,
        preprocessing_mode=preprocessing_mode,
    )

    original_graph_json = graph_to_json(original_graph, max_edges=None)
    original_edge_keys = [str(link["edge_key"]) for link in original_graph_json["links"]]

    return {
        "dataset_id": dataset_id,
        "dataset_label": dataset_label,
        "is_custom": is_custom,
        "score_source": score_source,
        "score_source_used": resolved_source,
        "session_id": session_id,
        "original_graph": original_graph_json,
        "original_edge_keys": original_edge_keys,
        **result,
    }



def run_multi_feature_study(
    dataset_id: str,
    contamination: float | None = None,
    score_source: str = "auto",
    session_id: str | None = None,
    is_custom: bool = False,
    scaling_mode: str = "none",
    high_region_pct: float = 10.0,
    low_region_pct: float = 10.0,
) -> dict:
    dataset_path, dataset_label = resolve_dataset_path(dataset_id, is_custom=is_custom)
    original_graph = load_graph(dataset_path)
    scored_df, resolved_source = build_combined_scored_dataframe(
        dataset_path=dataset_path,
        score_source=score_source,
        session_id=session_id,
    )

    effective_contamination: float = normalize_selection_fraction(contamination)
    result = run_multi_feature_experiment(
        original_graph=original_graph,
        scored_df=scored_df,
        contamination=effective_contamination,
        scaling_mode=scaling_mode,
        high_region_pct=high_region_pct / 100.0,
        low_region_pct=low_region_pct / 100.0,
    )

    return {
        "dataset_id": dataset_id,
        "dataset_label": dataset_label,
        "is_custom": is_custom,
        "score_source": score_source,
        "score_source_used": resolved_source,
        "session_id": session_id,
        **result,
    }



def run_iterative_extraction_study(
    dataset_id: str,
    method_ids: list[str],
    target_percent: float,
    stage_percents: list[float],
    low_region_percent: float = 10.0,
    high_region_percent: float = 10.0,
    score_source: str = "auto",
    session_id: str | None = None,
    is_custom: bool = False,
) -> dict:
    dataset_path, dataset_label = resolve_dataset_path(dataset_id, is_custom=is_custom)
    original_graph = load_graph(dataset_path)
    scored_df, resolved_source = build_combined_scored_dataframe(
        dataset_path=dataset_path,
        score_source=score_source,
        session_id=session_id,
    )

    result = run_iterative_extraction_experiment(
        original_graph=original_graph,
        scored_df=scored_df,
        methods=method_ids,
        target_percent=target_percent,
        stage_percents=stage_percents,
        low_region_percent=low_region_percent,
        high_region_percent=high_region_percent,
    )

    return {
        "dataset_id": dataset_id,
        "dataset_label": dataset_label,
        "is_custom": is_custom,
        "score_source": score_source,
        "score_source_used": resolved_source,
        "session_id": session_id,
        **result,
    }
