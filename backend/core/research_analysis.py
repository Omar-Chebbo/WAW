"""
backend/core/research_analysis.py
Implements the exploratory analysis required for the preprocessing study:
- score distribution characterization;
- transformation experiments;
- automatic preprocessing recommendation;
- backbone extraction after anomaly detection.
"""
from __future__ import annotations

from typing import Dict

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from backend.core.anomaly import DEFAULT_SELECTION_FRACTION, top_count_from_fraction, normalize_selection_fraction

from backend.core.preprocessing import (
    TRANSFORM_DESCRIPTIONS,
    apply_transformation,
    choose_preprocessing,
    classify_distribution,
    compute_distribution_stats,
)


TRANSFORM_ORDER = ["raw", "log", "minmax", "zscore", "log_minmax", "log_zscore"]
TRANSFORM_LABELS = {
    "raw": "Raw scores",
    "log": "Logarithmic",
    "minmax": "Min-Max normalization",
    "zscore": "Z-Score standardization",
    "log_minmax": "Log + Min-Max",
    "log_zscore": "Log + Z-Score",
}


def _edge_key(row: pd.Series) -> tuple[str, str]:
    u = str(row["source"])
    v = str(row["target"])
    return tuple(sorted((u, v)))


def _build_backbone_frame(df: pd.DataFrame, labels: np.ndarray) -> pd.DataFrame:
    return df.loc[labels == -1].copy()


def _backbone_summary(df: pd.DataFrame, backbone_df: pd.DataFrame, prepared_scores: np.ndarray) -> dict:
    n_total = int(len(df))
    n_backbone = int(len(backbone_df))

    if n_total == 0:
        return {
            "n_total": 0,
            "n_backbone": 0,
            "pct_backbone": 0.0,
            "node_count": 0,
            "component_count": 0,
            "edge_retention": 0.0,
            "backbone_score_mean": 0.0,
            "normal_score_mean": 0.0,
        }

    mask = np.zeros(n_total, dtype=bool)
    if n_backbone > 0:
        mask[backbone_df.index.to_numpy()] = True

    backbone_scores = prepared_scores[mask]
    normal_scores = prepared_scores[~mask]

    G = nx.from_pandas_edgelist(backbone_df, source="source", target="target", edge_attr=True)

    return {
        "n_total": n_total,
        "n_backbone": n_backbone,
        "pct_backbone": round((n_backbone / n_total) * 100, 2),
        "node_count": int(G.number_of_nodes()),
        "component_count": int(nx.number_connected_components(G)) if G.number_of_nodes() else 0,
        "edge_retention": round((n_backbone / n_total) * 100, 2),
        "backbone_score_mean": round(float(np.mean(backbone_scores)), 6) if backbone_scores.size else 0.0,
        "normal_score_mean": round(float(np.mean(normal_scores)), 6) if normal_scores.size else 0.0,
    }


def _edge_jaccard(base_df: pd.DataFrame, other_df: pd.DataFrame) -> float:
    a = {_edge_key(row) for _, row in base_df.iterrows()}
    b = {_edge_key(row) for _, row in other_df.iterrows()}
    union = a | b
    if not union:
        return 1.0
    return round(len(a & b) / len(union), 6)


def run_transformation_experiments(df: pd.DataFrame, score_column: str, selection_fraction: float = DEFAULT_SELECTION_FRACTION) -> dict:
    raw_scores = df[score_column].to_numpy(dtype=float)
    experiments: Dict[str, dict] = {}
    raw_backbone_df = None

    for transform_id in TRANSFORM_ORDER:
        try:
            prepared = apply_transformation(raw_scores, transform_id)

            clf = IsolationForest(contamination="auto", random_state=42)
            clf.fit(prepared.reshape(-1, 1))
            score_samples = clf.score_samples(prepared.reshape(-1, 1)).reshape(-1)
            rank_order = np.argsort(score_samples, kind="mergesort")
            rank = np.empty_like(rank_order)
            rank[rank_order] = np.arange(1, len(score_samples) + 1)
            selected_count = top_count_from_fraction(len(df), selection_fraction)
            labels = np.where(rank <= selected_count, -1, 1)

            backbone_df = _build_backbone_frame(df, labels)
            transformed_stats = compute_distribution_stats(prepared)

            result = {
                "transform_id": transform_id,
                "label": TRANSFORM_LABELS[transform_id],
                "description": TRANSFORM_DESCRIPTIONS[transform_id],
                "transformed_stats": transformed_stats,
                "backbone": _backbone_summary(df, backbone_df, prepared),
                "selection_rule": f"top_{selection_fraction:.2f}_fraction_by_isolation_forest_rank",
                "selection_fraction": selection_fraction,
                "selected_edges": [list(_edge_key(row)) for _, row in backbone_df.iterrows()],
            }

            if raw_backbone_df is None and transform_id == "raw":
                raw_backbone_df = backbone_df
                result["backbone"]["jaccard_vs_raw"] = 1.0
            elif raw_backbone_df is not None:
                result["backbone"]["jaccard_vs_raw"] = _edge_jaccard(raw_backbone_df, backbone_df)

            experiments[transform_id] = result

        except Exception as exc:
            experiments[transform_id] = {
                "transform_id": transform_id,
                "label": TRANSFORM_LABELS[transform_id],
                "description": TRANSFORM_DESCRIPTIONS[transform_id],
                "error": str(exc),
            }

    return experiments


def run_research_analysis(
    G: nx.Graph,
    scored_df: pd.DataFrame,
    method_id: str,
    score_column: str,
    network_label: str,
    contamination: float | str | None = None,
) -> dict:
    raw_scores = scored_df[score_column].to_numpy(dtype=float)

    distribution = classify_distribution(raw_scores)
    recommendation = choose_preprocessing(raw_scores)
    selection_fraction = normalize_selection_fraction(contamination)
    experiments = run_transformation_experiments(scored_df, score_column, selection_fraction)

    # Keep payload small enough for API responses
    for result in experiments.values():
        if "selected_edges" in result:
            result["backbone"]["sample_edge_count_listed"] = min(len(result["selected_edges"]), 20)
            result["selected_edges"] = result["selected_edges"][:20]

    return {
        "network": network_label,
        "method": method_id.upper(),
        "score_column": score_column,
        "n_nodes": int(G.number_of_nodes()),
        "n_edges": int(G.number_of_edges()),
        "distribution": distribution,
        "preprocessing_recommendation": recommendation,
        "selection_fraction": selection_fraction,
        "selection_rule": "top_percent_by_isolation_forest_rank",
        "transformation_metadata": {
            key: {
                "label": TRANSFORM_LABELS[key],
                "description": TRANSFORM_DESCRIPTIONS[key],
            }
            for key in TRANSFORM_ORDER
        },
        "transformation_experiments": experiments,
        "algorithmic_notes": {
            "computational_cost": (
                "Preferential Attachment is relatively cheap because it is degree-based. "
                "Local Path Index is more expensive because it enumerates short paths for every edge."
            ),
            "runtime_classification_limitations": (
                "The preprocessing decision uses heuristics based on skewness, zero inflation, and score diversity. "
                "These rules are interpretable, but they are not universally optimal."
            ),
            "design_tradeoff": (
                "A dynamic decision adds flexibility but also adds another layer of hyperparameters. "
                "For the current PA/LP pipeline, raw scores are the safer default; use transformations only for comparison."
            ),
        },
    }