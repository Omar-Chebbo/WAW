"""
backend/core/contamination_analysis.py
Dedicated multi-run contamination experiments for the Lab area.
This is intentionally separate from the preprocessing study.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import networkx as nx
import pandas as pd

from backend.core.anomaly import anomaly_summary, label_anomalies
from backend.core.evaluation import (
    edge_fraction,
    node_fraction,
    number_components,
    reachability,
)
from backend.core.methods import METHOD_REGISTRY
from backend.services.anomaly_service import (
    build_anomaly_inspector_from_df,
    build_labeled_rows_from_df,
    normalize_preprocessing_mode,
)


@dataclass(frozen=True)
class ContaminationSpec:
    label: str
    value: float | None
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

        lowered = token.lower()
        if lowered == "auto":
            key = "auto"
            if key in seen:
                continue
            seen.add(key)
            result.append(ContaminationSpec(label="Auto", value=None, sort_key=-1.0))
            continue

        try:
            value = float(token)
        except ValueError as exc:
            raise ValueError(f"Unsupported contamination value '{token}'. Use 'Auto' or a number in (0, 0.5].") from exc

        if not (0 < value <= 0.5):
            raise ValueError(
                f"Manual contamination '{token}' is invalid. Isolation Forest requires values in (0, 0.5]."
            )

        label = token
        key = f"manual:{value:.12f}"
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
    scored_df: pd.DataFrame,
    method_id: str,
    score_column: str,
    preprocessing_mode: str,
    spec: ContaminationSpec,
) -> dict:
    labeled = label_anomalies(
        scored_df.copy(),
        score_column,
        transform_id=preprocessing_mode,
        contamination=spec.value if spec.value is not None else "auto",
    )

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
        "threshold": summary.get("threshold"),
        "decision_function_threshold": 0.0,
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
    if method_id not in {"pa", "lp"}:
        raise ValueError("Contamination experiments currently support only 'pa' and 'lp'.")

    config = METHOD_REGISTRY[method_id]
    score_column = config["score_column"]
    transform_id = normalize_preprocessing_mode(preprocessing_mode) or "raw"
    specs = normalize_contamination_specs(contamination_values)

    runs = [
        _run_single_contamination(
            original_graph=original_graph,
            scored_df=scored_df,
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
        "stable_edge_key_format": "source|target with sorted endpoints",
        "run_count": len(runs),
        "runs": runs,
    }
