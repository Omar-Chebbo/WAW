"""
backend/services/research_service.py
Service layer for the preprocessing research task.
"""
from __future__ import annotations

from pathlib import Path

import networkx as nx

from backend.config import RAW_DIR
from backend.core.methods import METHOD_REGISTRY
from backend.core.research_analysis import run_research_analysis
from backend.services.graph_service import load_graph


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


def run_benchmark_research(network_id: str, method_id: str) -> dict:
    if method_id not in {"pa", "lp"}:
        raise ValueError("This research endpoint supports only 'pa' and 'lp'.")

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