"""
backend/core/contamination_analysis.py
Dedicated multi-run contamination experiments for the Lab area.

New contamination logic:
Isolation Forest is fitted once to produce a stable anomaly ranking. Each
contamination value is then interpreted as the percentage of top-ranked edges to
keep as the backbone. No sklearn threshold/predict cutoff is used for selection.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import networkx as nx
import pandas as pd

from backend.core.anomaly import (
    anomaly_summary,
    label_anomalies,
    extract_result_dataframe,
    apply_top_fraction_selection,
    normalize_selection_fraction,
)
from backend.core.evaluation import (
    edge_fraction,
    node_fraction,
    number_components,
    reachability,
)
from backend.core.methods import METHOD_REGISTRY
from backend.core.multi_feature_analysis import label_multifeature_edges
from backend.services.anomaly_service import (
    build_anomaly_inspector_from_df,
    build_labeled_rows_from_df,
    normalize_preprocessing_mode,
)


@dataclass(frozen=True)
class ContaminationSpec:
    label: str
    value: float
    sort_key: float


def stable_edge_key(source: object, target: object) -> str:
    left, right = sorted((str(source), str(target)))
    return f"{left}|{right}"


def normalize_contamination_specs(values: Iterable[str | float | int]) -> list[ContaminationSpec]:
    seen: set[str] = set()
    result: list[ContaminationSpec] = []

    for raw in values:
        token = str(raw).strip()
        if not token:
            continue

        if token.lower() in {"auto", "default"}:
            # Backward compatibility with old UI/history. There is no auto
            # threshold in the new logic, so this maps to top 10%.
            value = normalize_selection_fraction(None)
        else:
            value = normalize_selection_fraction(token)

        label = f"{value:.2f}"
        key = f"selection:{value:.12f}"
        if key in seen:
            continue
        seen.add(key)
        result.append(ContaminationSpec(label=label, value=value, sort_key=value))

    if not result:
        raise ValueError("At least one contamination value is required.")

    return sorted(result, key=lambda item: (item.sort_key, item.label))


def _build_backbone_graph(backbone_df: pd.DataFrame) -> nx.Graph:
    if backbone_df.empty:
        return nx.Graph()
    edge_attr = [col for col in backbone_df.columns if col not in {"source", "target"}]
    return nx.from_pandas_edgelist(
        backbone_df,
        source="source",
        target="target",
        edge_attr=edge_attr or None,
    )


def _extract_selected_edge_keys(backbone_df: pd.DataFrame) -> list[str]:
    if backbone_df.empty:
        return []
    return sorted(
        stable_edge_key(row["source"], row["target"])
        for _, row in backbone_df.iterrows()
    )


def _run_single_contamination(
    original_graph: nx.Graph,
    ranked_df: pd.DataFrame,
    method_id: str,
    score_column: str,
    preprocessing_mode: str,
    spec: ContaminationSpec,
) -> dict:
    # Reuse the same Isolation Forest ranking for every contamination value.
    # Contamination is now only the percentage cut into the sorted ranking.
    labeled = apply_top_fraction_selection(ranked_df, score_column, spec.value)

    anomaly_col = f"{score_column}_anomaly"
    backbone_df = labeled.loc[labeled[anomaly_col] == -1].copy()
    backbone_graph = _build_backbone_graph(backbone_df)

    edge_fraction_value, _ = edge_fraction(original_graph, backbone_graph)
    node_fraction_value, _ = node_fraction(original_graph, backbone_graph)
    reachability_value, _ = reachability(original_graph, backbone_graph)
    component_value, _ = number_components(original_graph, backbone_graph)

    summary = anomaly_summary(labeled, score_column)
    inspector = build_anomaly_inspector_from_df(labeled, method_id)
    rows = build_labeled_rows_from_df(labeled)
    selected_edge_keys = _extract_selected_edge_keys(backbone_df)

    return {
        "contamination_label": spec.label,
        "contamination_value": spec.value,
        "preprocessing_used": preprocessing_mode,
        "threshold": None,
        "cutoff_rank": summary.get("cutoff_rank"),
        "cutoff_score_samples": summary.get("cutoff_score_samples"),
        "decision_function_threshold": None,
        "flagged_edges": summary["flagged"],
        "edge_fraction": round(float(edge_fraction_value), 6),
        "node_fraction": round(float(node_fraction_value), 6),
        "reachability": round(float(reachability_value), 6),
        "connected_components": int(component_value),
        "selected_edge_keys": selected_edge_keys,
        "summary": summary,
        "inspector": inspector,
        "rows": rows,
    }


def run_contamination_experiment(
    original_graph: nx.Graph,
    scored_df: pd.DataFrame,
    method_id: str,
    contamination_values: Iterable[str | float | int],
    preprocessing_mode: str | None = None,
) -> dict:
    if method_id not in {"pa", "lp", "pa_lp"}:
        raise ValueError("Contamination experiments currently support only 'pa', 'lp', and 'pa_lp'.")

    config = METHOD_REGISTRY[method_id]
    score_column = config["score_column"]
    transform_id = normalize_preprocessing_mode(preprocessing_mode) or "raw"
    specs = normalize_contamination_specs(contamination_values)

    # Fit Isolation Forest once to get a stable anomaly ranking. Every run below
    # slices the same ranked table at a different top percentage.
    if method_id == "pa_lp":
        scaling_mode = "none" if transform_id == "raw" else transform_id
        ranked_df = label_multifeature_edges(
            scored_df.copy(),
            contamination=normalize_selection_fraction(None),
            scaling_mode=scaling_mode,
        )
    else:
        base_result = label_anomalies(
            scored_df.copy(),
            score_column,
            transform_id=transform_id,
            contamination=normalize_selection_fraction(None),
        )
        ranked_df = extract_result_dataframe(base_result)

    runs = [
        _run_single_contamination(
            original_graph=original_graph,
            ranked_df=ranked_df,
            method_id=method_id,
            score_column=score_column,
            preprocessing_mode=transform_id,
            spec=spec,
        )
        for spec in specs
    ]

    return {
        "method_id": method_id,
        "method_label": config["label"],
        "score_column": score_column,
        "preprocessing_used": transform_id,
        "selection_rule": "top_percent_by_isolation_forest_rank",
        "stable_edge_key_format": "source|target with sorted endpoints",
        "run_count": len(runs),
        "runs": runs,
    }
