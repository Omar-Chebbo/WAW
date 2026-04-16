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
from backend.core.contamination_analysis import run_contamination_experiment
from backend.core.methods import METHOD_REGISTRY
from backend.core.multi_feature_analysis import run_multi_feature_experiment
from backend.core.research_analysis import run_research_analysis
from backend.services.graph_service import graph_to_json, load_graph
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


PA_COLUMN = "preferential_attachment_1"
LP_COLUMN = "local_path_index_1"



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
    score_source: str = "compute_fresh",
    session_id: str | None = None,
):
    if method_id not in {"pa", "lp"}:
        raise ValueError("This research endpoint supports only 'pa' and 'lp'.")

    if score_source == "session_scores":
        if not session_id:
            raise ValueError("session_id is required when score_source='session_scores'.")
        scored_df = load_scores(session_id, method_id)
        return scored_df, "session_scores"

    if score_source != "compute_fresh":
        raise ValueError("score_source must be either 'compute_fresh' or 'session_scores'.")

    G = load_graph(dataset_path)
    config = METHOD_REGISTRY[method_id]
    scored_graph = config["function"](G.copy(), **config.get("kwargs", {}))
    scored_df = nx.to_pandas_edgelist(scored_graph)
    return scored_df, "compute_fresh"



def build_combined_scored_dataframe(
    dataset_path: Path,
    score_source: str = "compute_fresh",
    session_id: str | None = None,
) -> tuple[pd.DataFrame, str]:
    if score_source == "session_scores":
        if not session_id:
            raise ValueError("session_id is required when score_source='session_scores'.")
        pa_df = load_scores(session_id, "pa")
        lp_df = load_scores(session_id, "lp")
        resolved_source = "session_scores"
    elif score_source == "compute_fresh":
        original_graph = load_graph(dataset_path)
        pa_graph = METHOD_REGISTRY["pa"]["function"](original_graph.copy(), **METHOD_REGISTRY["pa"].get("kwargs", {}))
        lp_graph = METHOD_REGISTRY["lp"]["function"](original_graph.copy(), **METHOD_REGISTRY["lp"].get("kwargs", {}))
        pa_df = nx.to_pandas_edgelist(pa_graph)
        lp_df = nx.to_pandas_edgelist(lp_graph)
        resolved_source = "compute_fresh"
    else:
        raise ValueError("score_source must be either 'compute_fresh' or 'session_scores'.")

    merge_keys = ["source", "target"]
    optional_keys = [key for key in ["weight"] if key in pa_df.columns and key in lp_df.columns]
    merge_keys += optional_keys

    required_pa = merge_keys + [PA_COLUMN]
    required_lp = merge_keys + [LP_COLUMN]

    combined = pa_df[required_pa].merge(lp_df[required_lp], on=merge_keys, how="inner")
    if combined.empty:
        raise ValueError("Could not build a combined PA/LP score table for the selected dataset.")
    return combined, resolved_source



def run_benchmark_research(network_id: str, method_id: str) -> dict:
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
    )



def run_contamination_study(
    dataset_id: str,
    method_id: str,
    contamination_values: list[str],
    preprocessing_mode: str | None = None,
    score_source: str = "compute_fresh",
    session_id: str | None = None,
    is_custom: bool = False,
) -> dict:
    dataset_path, dataset_label = resolve_dataset_path(dataset_id, is_custom=is_custom)
    original_graph = load_graph(dataset_path)
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
        "score_source": resolved_source,
        "session_id": session_id,
        "original_graph": original_graph_json,
        "original_edge_keys": original_edge_keys,
        **result,
    }



def run_multi_feature_study(
    dataset_id: str,
    contamination: float | None = None,
    score_source: str = "compute_fresh",
    session_id: str | None = None,
    is_custom: bool = False,
    scaling_mode: str = "none",
) -> dict:
    dataset_path, dataset_label = resolve_dataset_path(dataset_id, is_custom=is_custom)
    original_graph = load_graph(dataset_path)
    scored_df, resolved_source = build_combined_scored_dataframe(
        dataset_path=dataset_path,
        score_source=score_source,
        session_id=session_id,
    )

    effective_contamination: float | str = contamination if contamination is not None else "auto"
    result = run_multi_feature_experiment(
        original_graph=original_graph,
        scored_df=scored_df,
        contamination=effective_contamination,
        scaling_mode=scaling_mode,
    )

    return {
        "dataset_id": dataset_id,
        "dataset_label": dataset_label,
        "is_custom": is_custom,
        "score_source": resolved_source,
        "session_id": session_id,
        **result,
    }
