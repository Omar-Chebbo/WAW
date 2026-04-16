"""
Iterative anomaly extraction research experiment.

This lab compares a normal one-shot Isolation Forest backbone with a progressive
multi-stage extraction. Every stage percentage is measured against the original
edge count, while Isolation Forest is refit on the remaining score table at each
stage. This keeps the final target fair while testing whether later stages reveal
secondary anomalies hidden behind the first strong extremes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Any

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from backend.core.evaluation import (
    edge_fraction,
    node_fraction,
    reachability,
    number_components,
    transitivity,
    average_clustering,
    degree_entropy,
    weight_entropy,
    average_path_length,
    compute_distributions,
)
from backend.services.graph_service import graph_to_json, stable_edge_key

PA_COLUMN = "preferential_attachment_1"
LP_COLUMN = "local_path_index_1"
SUPPORTED_METHODS = ("pa", "lp", "pa_lp")

METHOD_META = {
    "pa": {
        "label": "Preferential Attachment",
        "short": "PA",
        "features": [PA_COLUMN],
        "primary_score": PA_COLUMN,
        "score_label": "PA score",
        "color": "#4F46E5",
    },
    "lp": {
        "label": "Local Path Index",
        "short": "LP",
        "features": [LP_COLUMN],
        "primary_score": LP_COLUMN,
        "score_label": "LP score",
        "color": "#C2410C",
    },
    "pa_lp": {
        "label": "PA + LP",
        "short": "PA+LP",
        "features": [PA_COLUMN, LP_COLUMN],
        "primary_score": PA_COLUMN,
        "score_label": "Joint PA-LP profile",
        "color": "#0F766E",
    },
}


@dataclass(frozen=True)
class RankingResult:
    table: pd.DataFrame
    features: list[str]
    prefix: str


def _round_float(value: Any, digits: int = 6) -> float | None:
    try:
        if pd.isna(value):
            return None
        return round(float(value), digits)
    except Exception:
        return None


def _edge_key_from_row(row: pd.Series) -> str:
    return stable_edge_key(row["source"], row["target"])


def _feature_matrix(df: pd.DataFrame, features: list[str]) -> np.ndarray:
    if not features:
        raise ValueError("At least one feature column is required.")
    missing = [column for column in features if column not in df.columns]
    if missing:
        raise ValueError(f"Missing score column(s): {missing}")
    return df[features].astype(float).to_numpy()


def _rank_with_isolation_forest(df: pd.DataFrame, features: list[str], prefix: str) -> RankingResult:
    ranked = df.copy().reset_index(drop=True)
    if ranked.empty:
        ranked[f"{prefix}_if_rank"] = []
        ranked[f"{prefix}_if_score_samples"] = []
        ranked[f"{prefix}_if_decision_function"] = []
        ranked[f"{prefix}_anomaly_score"] = []
        return RankingResult(table=ranked, features=features, prefix=prefix)

    X = _feature_matrix(ranked, features)
    clf = IsolationForest(
        contamination="auto",
        max_samples=len(ranked),
        random_state=42,
    )
    clf.fit(X)
    score_samples = clf.score_samples(X).reshape(-1)
    decision_scores = clf.decision_function(X).reshape(-1)

    order = np.argsort(score_samples, kind="mergesort")
    rank = np.empty_like(order)
    rank[order] = np.arange(1, len(score_samples) + 1)

    ranked[f"{prefix}_if_score_samples"] = score_samples
    ranked[f"{prefix}_if_decision_function"] = decision_scores
    ranked[f"{prefix}_anomaly_score"] = -score_samples
    ranked[f"{prefix}_if_rank"] = rank
    ranked["edge_key"] = ranked.apply(_edge_key_from_row, axis=1)
    ranked = ranked.sort_values(f"{prefix}_if_rank", ascending=True).reset_index(drop=True)
    return RankingResult(table=ranked, features=features, prefix=prefix)


def _count_from_percent(total_edges: int, percent: float) -> int:
    if total_edges <= 0 or percent <= 0:
        return 0
    return min(total_edges, max(1, int(np.ceil(total_edges * percent / 100.0))))


def _stage_counts(total_edges: int, target_percent: float, stage_percents: list[float]) -> list[int]:
    if total_edges <= 0:
        return [0 for _ in stage_percents]
    if not stage_percents:
        raise ValueError("At least one stage percentage is required.")
    if any(p <= 0 for p in stage_percents):
        raise ValueError("Every stage percentage must be greater than 0.")

    target_count = _count_from_percent(total_edges, target_percent)
    counts: list[int] = []
    for idx, percent in enumerate(stage_percents):
        if idx == len(stage_percents) - 1:
            remaining_needed = target_count - sum(counts)
            counts.append(max(0, remaining_needed))
        else:
            counts.append(_count_from_percent(total_edges, percent))

    # Defensive correction if rounding made the previous stages reach the target.
    running = 0
    corrected: list[int] = []
    for count in counts:
        allowed = max(0, target_count - running)
        next_count = min(count, allowed)
        corrected.append(next_count)
        running += next_count
    return corrected


def _selected_graph(df: pd.DataFrame) -> nx.Graph:
    if df.empty:
        return nx.Graph()
    attrs = [column for column in df.columns if column not in {"source", "target"}]
    return nx.from_pandas_edgelist(df, source="source", target="target", edge_attr=attrs or None)


def _metric_bundle(original_graph: nx.Graph, selected_df: pd.DataFrame) -> dict:
    backbone = _selected_graph(selected_df)
    ef, _ = edge_fraction(original_graph, backbone)
    nf, _ = node_fraction(original_graph, backbone)
    r, _ = reachability(original_graph, backbone)
    comps, _ = number_components(original_graph, backbone)
    tr, tr_dev = transitivity(original_graph, backbone)
    cl, cl_dev = average_clustering(original_graph, backbone)
    de, de_dev = degree_entropy(original_graph, backbone)
    we, we_dev = weight_entropy(original_graph, backbone)
    apl, apl_dev = average_path_length(original_graph, backbone)
    distributions = compute_distributions(original_graph, backbone)
    return {
        "final_edges": int(backbone.number_of_edges()),
        "retained_nodes": int(backbone.number_of_nodes()),
        "edge_fraction": round(float(ef), 6),
        "node_fraction": round(float(nf), 6),
        "reachability": round(float(r), 6),
        "connected_components": int(comps),
        "transitivity": round(float(tr), 6),
        "transitivity_deviation": round(float(tr_dev), 6),
        "avg_clustering": round(float(cl), 6),
        "avg_clustering_deviation": round(float(cl_dev), 6),
        "degree_entropy": round(float(de), 6),
        "degree_entropy_deviation": round(float(de_dev), 6),
        "weight_entropy": round(float(we), 6),
        "weight_entropy_deviation": round(float(we_dev), 6),
        "avg_path_length": round(float(apl), 6),
        "avg_path_length_deviation": round(float(apl_dev), 6),
        "degree_ks": distributions["degree"]["ks"],
        "weight_ks": distributions["weight"]["ks"],
    }


def _score_stats(df: pd.DataFrame, columns: list[str]) -> dict:
    stats = {}
    for column in columns:
        if column not in df.columns or df.empty:
            stats[column] = {"min": None, "max": None, "mean": None, "median": None}
            continue
        values = df[column].astype(float)
        stats[column] = {
            "min": _round_float(values.min()),
            "max": _round_float(values.max()),
            "mean": _round_float(values.mean()),
            "median": _round_float(values.median()),
        }
    return stats


def _feature_label(column: str) -> str:
    if column == PA_COLUMN:
        return "PA score"
    if column == LP_COLUMN:
        return "LP score"
    return column


def _histogram_bin_edges(base_df: pd.DataFrame, features: list[str], bins: int = 24) -> dict[str, list[float]]:
    """Build stable raw-score bin edges from the original score distribution.

    All one-shot and iterative stage histograms reuse these same edges, so the
    user can visually compare how the distribution changes after each stage.
    """
    edges: dict[str, list[float]] = {}
    for column in features:
        if column not in base_df.columns or base_df.empty:
            edges[column] = [0.0, 1.0]
            continue
        values = base_df[column].astype(float).replace([np.inf, -np.inf], np.nan).dropna().to_numpy()
        if values.size == 0:
            edges[column] = [0.0, 1.0]
            continue
        lo = float(np.min(values))
        hi = float(np.max(values))
        if not np.isfinite(lo) or not np.isfinite(hi):
            edges[column] = [0.0, 1.0]
            continue
        if lo == hi:
            pad = abs(lo) * 0.05 if lo else 1.0
            lo -= pad
            hi += pad
        edges[column] = [float(x) for x in np.linspace(lo, hi, bins + 1)]
    return edges


def _histogram_for_column(input_df: pd.DataFrame, selected_df: pd.DataFrame, column: str, edges: list[float]) -> dict:
    if len(edges) < 2:
        edges = [0.0, 1.0]
    input_values = input_df[column].astype(float).replace([np.inf, -np.inf], np.nan).dropna().to_numpy() if column in input_df.columns else np.array([])
    selected_values = selected_df[column].astype(float).replace([np.inf, -np.inf], np.nan).dropna().to_numpy() if column in selected_df.columns else np.array([])

    all_counts, _ = np.histogram(input_values, bins=np.asarray(edges, dtype=float))
    selected_counts, _ = np.histogram(selected_values, bins=np.asarray(edges, dtype=float))
    bins_payload = []
    for idx, (start, end) in enumerate(zip(edges[:-1], edges[1:])):
        bins_payload.append({
            "bin_index": idx + 1,
            "start": _round_float(start),
            "end": _round_float(end),
            "all_count": int(all_counts[idx]) if idx < len(all_counts) else 0,
            "selected_count": int(selected_counts[idx]) if idx < len(selected_counts) else 0,
        })

    selected_total = int(selected_values.size)
    input_total = int(input_values.size)
    return {
        "feature": column,
        "label": _feature_label(column),
        "input_edges": input_total,
        "selected_edges": selected_total,
        "selected_share_percent": round(float(selected_total / input_total * 100), 4) if input_total else 0.0,
        "min": _round_float(np.min(input_values)) if input_values.size else None,
        "max": _round_float(np.max(input_values)) if input_values.size else None,
        "bins": bins_payload,
    }


def _score_histograms(input_df: pd.DataFrame, selected_df: pd.DataFrame, features: list[str], bin_edges: dict[str, list[float]]) -> list[dict]:
    return [
        _histogram_for_column(input_df, selected_df, column, bin_edges.get(column, [0.0, 1.0]))
        for column in features
    ]


def _histogram_for_values(input_values: np.ndarray, selected_values: np.ndarray, label: str, feature: str, bins: int = 24) -> dict:
    input_values = np.asarray(input_values, dtype=float)
    selected_values = np.asarray(selected_values, dtype=float)
    input_values = input_values[np.isfinite(input_values)]
    selected_values = selected_values[np.isfinite(selected_values)]
    if input_values.size == 0:
        edges = np.asarray([0.0, 1.0])
    else:
        lo = float(np.min(input_values))
        hi = float(np.max(input_values))
        if lo == hi:
            pad = abs(lo) * 0.05 if lo else 1.0
            lo -= pad
            hi += pad
        edges = np.linspace(lo, hi, bins + 1)
    all_counts, _ = np.histogram(input_values, bins=edges)
    selected_counts, _ = np.histogram(selected_values, bins=edges)
    return {
        "feature": feature,
        "label": label,
        "input_edges": int(input_values.size),
        "selected_edges": int(selected_values.size),
        "selected_share_percent": round(float(selected_values.size / input_values.size * 100), 4) if input_values.size else 0.0,
        "min": _round_float(np.min(input_values)) if input_values.size else None,
        "max": _round_float(np.max(input_values)) if input_values.size else None,
        "bins": [
            {
                "bin_index": idx + 1,
                "start": _round_float(start),
                "end": _round_float(end),
                "all_count": int(all_counts[idx]) if idx < len(all_counts) else 0,
                "selected_count": int(selected_counts[idx]) if idx < len(selected_counts) else 0,
            }
            for idx, (start, end) in enumerate(zip(edges[:-1], edges[1:]))
        ],
    }


def _model_output_histogram(ranked_df: pd.DataFrame, selected_df: pd.DataFrame, prefix: str) -> dict:
    column = f"{prefix}_if_score_samples"
    input_values = ranked_df[column].to_numpy(dtype=float) if column in ranked_df.columns else np.array([])
    selected_values = selected_df[column].to_numpy(dtype=float) if column in selected_df.columns else np.array([])
    return _histogram_for_values(
        input_values=input_values,
        selected_values=selected_values,
        label="Model output score_samples",
        feature="score_samples",
    )


def _region_labels(df: pd.DataFrame, column: str, low_percent: float = 10.0, high_percent: float = 10.0) -> tuple[pd.Series, dict]:
    """Rank-based low/middle/high labels for one score column.

    low_percent marks the bottom score region and high_percent marks the top
    score region. Both are measured against the original score table, so the
    user can test 10/10, 20/20, 50/50, etc.
    """
    labels = pd.Series("middle", index=df.index, dtype=object)
    total = len(df)
    if total == 0:
        return labels, {
            "low_percent": low_percent,
            "high_percent": high_percent,
            "middle_percent": max(0.0, 100.0 - low_percent - high_percent),
            "low_threshold": None,
            "median": None,
            "high_threshold": None,
            "p10": None,
            "p50": None,
            "p90": None,
            "low_count": 0,
            "middle_count": 0,
            "high_count": 0,
        }
    low_percent = max(0.0, min(100.0, float(low_percent)))
    high_percent = max(0.0, min(100.0, float(high_percent)))
    if low_percent + high_percent > 100.0:
        raise ValueError("Low and high score region percentages must sum to 100% or less.")

    ordered = df.sort_values(column, ascending=True)
    low_count = int(np.floor(total * low_percent / 100.0)) if low_percent > 0 else 0
    high_count = int(np.floor(total * high_percent / 100.0)) if high_percent > 0 else 0
    if low_percent > 0 and low_count == 0:
        low_count = 1
    if high_percent > 0 and high_count == 0:
        high_count = 1
    if low_count + high_count > total:
        high_count = max(0, total - low_count)

    low_idx = ordered.index[:low_count] if low_count else []
    high_idx = ordered.index[total - high_count:] if high_count else []
    labels.loc[low_idx] = "low"
    labels.loc[high_idx] = "high"
    values = df[column].astype(float)
    thresholds = {
        "low_percent": round(float(low_percent), 4),
        "high_percent": round(float(high_percent), 4),
        "middle_percent": round(float(max(0.0, 100.0 - low_percent - high_percent)), 4),
        "low_threshold": _round_float(values.quantile(low_percent / 100.0)) if low_percent > 0 else None,
        "median": _round_float(values.quantile(0.50)),
        "high_threshold": _round_float(values.quantile(max(0.0, 1.0 - high_percent / 100.0))) if high_percent > 0 else None,
        "low_count": int(low_count),
        "middle_count": int(total - low_count - high_count),
        "high_count": int(high_count),
    }
    thresholds["p10"] = thresholds["low_threshold"]
    thresholds["p50"] = thresholds["median"]
    thresholds["p90"] = thresholds["high_threshold"]
    return labels, thresholds


def _joint_region_labels(df: pd.DataFrame, low_percent: float = 10.0, high_percent: float = 10.0) -> tuple[pd.Series, dict]:
    pa_regions, pa_thresholds = _region_labels(df, PA_COLUMN, low_percent, high_percent)
    lp_regions, lp_thresholds = _region_labels(df, LP_COLUMN, low_percent, high_percent)
    joint = pd.Series([f"{pa}/{lp}" for pa, lp in zip(pa_regions, lp_regions)], index=df.index, dtype=object)
    return joint, {"pa": pa_thresholds, "lp": lp_thresholds}


def _selection_sets(one_shot_df: pd.DataFrame, iterative_df: pd.DataFrame) -> dict[str, set[str]]:
    one = set(one_shot_df["edge_key"].astype(str)) if not one_shot_df.empty else set()
    it = set(iterative_df["edge_key"].astype(str)) if not iterative_df.empty else set()
    return {
        "one_shot": one,
        "iterative": it,
        "common": one & it,
        "one_shot_only": one - it,
        "iterative_only": it - one,
    }


def _jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    left_set = set(left)
    right_set = set(right)
    union = left_set | right_set
    if not union:
        return 1.0
    return round(len(left_set & right_set) / len(union), 6)


def _region_analysis(base_df: pd.DataFrame, method_id: str, one_shot_df: pd.DataFrame, iterative_df: pd.DataFrame, stages: list[dict], low_region_percent: float = 10.0, high_region_percent: float = 10.0) -> dict:
    working = base_df.copy().reset_index(drop=True)
    working["edge_key"] = working.apply(_edge_key_from_row, axis=1)
    sets = _selection_sets(one_shot_df, iterative_df)

    if method_id == "pa_lp":
        labels, thresholds = _joint_region_labels(working, low_region_percent, high_region_percent)
        order = [
            "high/high", "high/middle", "high/low",
            "middle/high", "middle/middle", "middle/low",
            "low/high", "low/middle", "low/low",
        ]
    else:
        column = PA_COLUMN if method_id == "pa" else LP_COLUMN
        labels, thresholds = _region_labels(working, column, low_region_percent, high_region_percent)
        order = ["high", "middle", "low"]

    working["region"] = labels
    stage_sets = {
        int(stage["stage_index"]): set(stage.get("selected_edge_keys", []))
        for stage in stages
    }

    rows = []
    for region in order:
        region_edges = set(working.loc[working["region"] == region, "edge_key"].astype(str))
        stage_counts = {
            f"stage_{idx}": len(region_edges & edge_keys)
            for idx, edge_keys in stage_sets.items()
        }
        one_count = len(region_edges & sets["one_shot"])
        it_count = len(region_edges & sets["iterative"])
        rows.append({
            "region": region,
            "total_edges": len(region_edges),
            "one_shot_selected": one_count,
            "iterative_selected": it_count,
            "common": len(region_edges & sets["common"]),
            "one_shot_only": len(region_edges & sets["one_shot_only"]),
            "iterative_only": len(region_edges & sets["iterative_only"]),
            "one_shot_pct_of_region": round(float(one_count / len(region_edges) * 100), 2) if region_edges else 0.0,
            "iterative_pct_of_region": round(float(it_count / len(region_edges) * 100), 2) if region_edges else 0.0,
            **stage_counts,
        })

    high_tail_region = "high" if method_id != "pa_lp" else "high/high"
    high_tail_row = next((row for row in rows if row["region"] == high_tail_region), None)
    one_total = len(sets["one_shot"])
    it_total = len(sets["iterative"])
    high_tail_one = high_tail_row["one_shot_selected"] if high_tail_row else 0
    high_tail_it = high_tail_row["iterative_selected"] if high_tail_row else 0

    return {
        "region_type": "joint_3x3" if method_id == "pa_lp" else "one_dimensional_score_regions",
        "thresholds": thresholds,
        "rows": rows,
        "high_tail_domination": {
            "region": high_tail_region,
            "one_shot_count": high_tail_one,
            "iterative_count": high_tail_it,
            "one_shot_pct_of_selected": round(float(high_tail_one / one_total * 100), 2) if one_total else 0.0,
            "iterative_pct_of_selected": round(float(high_tail_it / it_total * 100), 2) if it_total else 0.0,
            "delta_pct": round(float((high_tail_it / it_total * 100 if it_total else 0.0) - (high_tail_one / one_total * 100 if one_total else 0.0)), 2),
        },
    }


def _build_layout_map(graph: nx.Graph) -> dict[str, tuple[float, float]]:
    try:
        layout = nx.spring_layout(graph, seed=42, weight="weight")
    except Exception:
        layout = {node: (0.0, 0.0) for node in graph.nodes()}
    return {str(node): (float(pos[0]), float(pos[1])) for node, pos in layout.items()}


def _graph_overlay(original_graph: nx.Graph, one_shot_df: pd.DataFrame, iterative_df: pd.DataFrame, stages: list[dict]) -> dict:
    layout = _build_layout_map(original_graph)
    base = graph_to_json(original_graph, max_edges=None)
    one = set(one_shot_df["edge_key"].astype(str)) if not one_shot_df.empty else set()
    it = set(iterative_df["edge_key"].astype(str)) if not iterative_df.empty else set()
    stage_by_edge: dict[str, int] = {}
    for stage in stages:
        for edge_key in stage.get("selected_edge_keys", []):
            stage_by_edge[str(edge_key)] = int(stage["stage_index"])

    nodes = []
    for node in base["nodes"]:
        x, y = layout.get(str(node["id"]), (0.0, 0.0))
        nodes.append({**node, "x": x, "y": y})

    links = []
    for link in base["links"]:
        key = str(link.get("edge_key"))
        if key in one and key in it:
            category = "common"
        elif key in one:
            category = "one_shot_only"
        elif key in it:
            category = "iterative_only"
        else:
            category = "not_selected"
        links.append({**link, "selection_category": category, "stage": stage_by_edge.get(key)})
    return {"nodes": nodes, "links": links, "sampled": False}


def _rank_scatter(base_df: pd.DataFrame, method_id: str, one_ranked: pd.DataFrame, iterative_df: pd.DataFrame, stages: list[dict], low_region_percent: float = 10.0, high_region_percent: float = 10.0) -> dict:
    meta = METHOD_META[method_id]
    primary = meta["primary_score"]
    prefix = method_id
    working = base_df.copy().reset_index(drop=True)
    working["edge_key"] = working.apply(_edge_key_from_row, axis=1)
    rank_cols = ["edge_key", f"{prefix}_if_rank", f"{prefix}_if_score_samples", f"{prefix}_if_decision_function"]
    ranks = one_ranked[rank_cols].copy()
    merged = working.merge(ranks, on="edge_key", how="left")

    one_set = set(one_ranked.loc[one_ranked["selected_one_shot"], "edge_key"].astype(str)) if "selected_one_shot" in one_ranked.columns else set()
    it_set = set(iterative_df["edge_key"].astype(str)) if not iterative_df.empty else set()
    stage_map: dict[str, int] = {}
    stage_rank_map: dict[str, int] = {}
    for stage in stages:
        for row in stage.get("selected_rows", []):
            edge_key = str(row["edge_key"])
            stage_map[edge_key] = int(stage["stage_index"])
            stage_rank_map[edge_key] = int(row.get("stage_rank") or 0)

    if method_id == "pa_lp":
        pa_regions, pa_th = _region_labels(working, PA_COLUMN, low_region_percent, high_region_percent)
        lp_regions, lp_th = _region_labels(working, LP_COLUMN, low_region_percent, high_region_percent)
        region_map = dict(zip(working["edge_key"], [f"{p}/{l}" for p, l in zip(pa_regions, lp_regions)]))
        thresholds = {"pa": pa_th, "lp": lp_th}
    else:
        regions, thresholds = _region_labels(working, primary, low_region_percent, high_region_percent)
        region_map = dict(zip(working["edge_key"], regions))

    points = []
    for _, row in merged.iterrows():
        edge_key = str(row["edge_key"])
        selected_one = edge_key in one_set
        selected_it = edge_key in it_set
        if selected_one and selected_it:
            category = "common"
        elif selected_one:
            category = "one_shot_only"
        elif selected_it:
            category = "iterative_only"
        else:
            category = "not_selected"
        payload = {
            "edge_key": edge_key,
            "source": str(row["source"]),
            "target": str(row["target"]),
            "score": _round_float(row[primary]),
            "pa_score": _round_float(row[PA_COLUMN]) if PA_COLUMN in row else None,
            "lp_score": _round_float(row[LP_COLUMN]) if LP_COLUMN in row else None,
            "one_shot_rank": int(row[f"{prefix}_if_rank"]) if not pd.isna(row.get(f"{prefix}_if_rank")) else None,
            "one_shot_score_samples": _round_float(row.get(f"{prefix}_if_score_samples")),
            "one_shot_decision_function": _round_float(row.get(f"{prefix}_if_decision_function")),
            "stage": stage_map.get(edge_key),
            "stage_rank": stage_rank_map.get(edge_key),
            "selection_category": category,
            "region": region_map.get(edge_key, "middle"),
        }
        points.append(payload)

    return {
        "mode": "score_vs_anomaly_rank",
        "x_axis": meta["score_label"],
        "y_axis": "Isolation Forest anomaly rank (rank 1 = most anomalous)",
        "thresholds": thresholds,
        "points": points,
    }


def _pa_lp_feature_scatter(base_df: pd.DataFrame, one_shot_df: pd.DataFrame, iterative_df: pd.DataFrame, stages: list[dict], low_region_percent: float = 10.0, high_region_percent: float = 10.0) -> dict | None:
    if PA_COLUMN not in base_df.columns or LP_COLUMN not in base_df.columns:
        return None
    working = base_df.copy().reset_index(drop=True)
    working["edge_key"] = working.apply(_edge_key_from_row, axis=1)
    one = set(one_shot_df["edge_key"].astype(str)) if not one_shot_df.empty else set()
    it = set(iterative_df["edge_key"].astype(str)) if not iterative_df.empty else set()
    stage_map: dict[str, int] = {}
    for stage in stages:
        for edge_key in stage.get("selected_edge_keys", []):
            stage_map[str(edge_key)] = int(stage["stage_index"])
    pa_regions, pa_thresholds = _region_labels(working, PA_COLUMN, low_region_percent, high_region_percent)
    lp_regions, lp_thresholds = _region_labels(working, LP_COLUMN, low_region_percent, high_region_percent)

    points = []
    for idx, row in working.iterrows():
        edge_key = str(row["edge_key"])
        selected_one = edge_key in one
        selected_it = edge_key in it
        if selected_one and selected_it:
            category = "common"
        elif selected_one:
            category = "one_shot_only"
        elif selected_it:
            category = "iterative_only"
        else:
            category = "not_selected"
        points.append({
            "edge_key": edge_key,
            "source": str(row["source"]),
            "target": str(row["target"]),
            "pa": _round_float(row[PA_COLUMN]),
            "lp": _round_float(row[LP_COLUMN]),
            "stage": stage_map.get(edge_key),
            "selection_category": category,
            "region_3x3": f"{pa_regions.iloc[idx]}/{lp_regions.iloc[idx]}",
        })
    return {
        "mode": "pa_vs_lp_feature_space",
        "x_axis": "Raw PA score",
        "y_axis": "Raw LP score",
        "thresholds": {"pa": pa_thresholds, "lp": lp_thresholds},
        "points": points,
    }


def _selected_rows_for_stage(selected: pd.DataFrame, score_columns: list[str], stage_index: int, prefix: str) -> list[dict]:
    rows = []
    for _, row in selected.iterrows():
        item = {
            "stage_index": stage_index,
            "edge_key": str(row["edge_key"]),
            "source": str(row["source"]),
            "target": str(row["target"]),
            "stage_rank": int(row[f"{prefix}_if_rank"]),
            "score_samples": _round_float(row[f"{prefix}_if_score_samples"]),
            "decision_function": _round_float(row[f"{prefix}_if_decision_function"]),
        }
        for column in score_columns:
            item[column] = _round_float(row[column])
        rows.append(item)
    return rows


def _edge_inspector(base_df: pd.DataFrame, one_ranked: pd.DataFrame, one_shot_df: pd.DataFrame, iterative_df: pd.DataFrame, stages: list[dict], method_id: str, low_region_percent: float = 10.0, high_region_percent: float = 10.0) -> list[dict]:
    prefix = method_id
    meta = METHOD_META[method_id]
    score_columns = meta["features"]
    base = base_df.copy().reset_index(drop=True)
    base["edge_key"] = base.apply(_edge_key_from_row, axis=1)

    one_ranks = one_ranked[["edge_key", f"{prefix}_if_rank", f"{prefix}_if_score_samples"]].copy()
    one_ranks = one_ranks.rename(columns={
        f"{prefix}_if_rank": "one_shot_rank",
        f"{prefix}_if_score_samples": "one_shot_score_samples",
    })
    merged = base.merge(one_ranks, on="edge_key", how="left")

    one = set(one_shot_df["edge_key"].astype(str)) if not one_shot_df.empty else set()
    it = set(iterative_df["edge_key"].astype(str)) if not iterative_df.empty else set()
    stage_map = {}
    stage_rank_map = {}
    stage_score_map = {}
    for stage in stages:
        for row in stage.get("selected_rows", []):
            key = str(row["edge_key"])
            stage_map[key] = int(stage["stage_index"])
            stage_rank_map[key] = int(row.get("stage_rank") or 0)
            stage_score_map[key] = row.get("score_samples")

    if method_id == "pa_lp":
        regions, _ = _joint_region_labels(base, low_region_percent, high_region_percent)
    else:
        regions, _ = _region_labels(base, meta["primary_score"], low_region_percent, high_region_percent)
    region_map = dict(zip(base["edge_key"], regions))

    rows = []
    interesting = one | it
    for _, row in merged.iterrows():
        key = str(row["edge_key"])
        if key not in interesting:
            continue
        if key in one and key in it:
            category = "common"
        elif key in one:
            category = "one_shot_only"
        else:
            category = "iterative_only"
        item = {
            "edge_key": key,
            "source": str(row["source"]),
            "target": str(row["target"]),
            "selection_category": category,
            "stage": stage_map.get(key),
            "one_shot_rank": int(row["one_shot_rank"]) if not pd.isna(row.get("one_shot_rank")) else None,
            "stage_rank": stage_rank_map.get(key),
            "one_shot_score_samples": _round_float(row.get("one_shot_score_samples")),
            "stage_score_samples": stage_score_map.get(key),
            "region": region_map.get(key, "middle"),
        }
        for column in score_columns:
            item[column] = _round_float(row[column])
        rows.append(item)

    return sorted(rows, key=lambda item: (item["selection_category"] != "common", item.get("stage") or 99, item.get("one_shot_rank") or 999999))


def _one_shot_result(original_graph: nx.Graph, base_df: pd.DataFrame, method_id: str, target_percent: float) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    meta = METHOD_META[method_id]
    target_count = _count_from_percent(len(base_df), target_percent)
    ranked = _rank_with_isolation_forest(base_df, meta["features"], method_id).table
    ranked["selected_one_shot"] = ranked[f"{method_id}_if_rank"].astype(int) <= target_count
    selected = ranked.loc[ranked["selected_one_shot"]].copy()
    metrics = _metric_bundle(original_graph, selected)
    metrics.update({
        "extraction": "one_shot",
        "target_percent": target_percent,
        "target_edges": target_count,
        "stage_count": 1,
    })
    return ranked, selected, metrics


def _iterative_result(original_graph: nx.Graph, base_df: pd.DataFrame, method_id: str, target_percent: float, stage_percents: list[float]) -> tuple[pd.DataFrame, list[dict], dict]:
    meta = METHOD_META[method_id]
    target_count = _count_from_percent(len(base_df), target_percent)
    counts = _stage_counts(len(base_df), target_percent, stage_percents)
    histogram_edges = _histogram_bin_edges(base_df, meta["features"])
    remaining = base_df.copy().reset_index(drop=True)
    remaining["edge_key"] = remaining.apply(_edge_key_from_row, axis=1)
    selected_frames: list[pd.DataFrame] = []
    stages: list[dict] = []

    for idx, (percent, count) in enumerate(zip(stage_percents, counts), start=1):
        if count <= 0 or remaining.empty:
            selected = remaining.iloc[0:0].copy()
            ranked = remaining.copy()
        else:
            ranked = _rank_with_isolation_forest(remaining, meta["features"], method_id).table
            count = min(count, len(ranked))
            selected = ranked.head(count).copy()
        selected["iterative_stage"] = idx
        selected_frames.append(selected)
        selected_keys = set(selected["edge_key"].astype(str)) if not selected.empty else set()

        stages.append({
            "stage_index": idx,
            "stage_percent_from_original": percent,
            "stage_target_edges": int(count),
            "input_table_size": int(len(remaining)),
            "selected_edges": int(len(selected)),
            "cutoff_rank": int(count) if count else 0,
            "cutoff_score_samples": _round_float(selected[f"{method_id}_if_score_samples"].max()) if not selected.empty else None,
            "score_stats": _score_stats(selected, meta["features"]),
            "score_histograms": _score_histograms(remaining, selected, meta["features"], histogram_edges),
            "model_output_histogram": _model_output_histogram(ranked, selected, method_id),
            "selected_edge_keys": sorted(selected_keys),
            "selected_rows": _selected_rows_for_stage(selected, meta["features"], idx, method_id),
        })
        if selected_keys:
            remaining = remaining.loc[~remaining["edge_key"].astype(str).isin(selected_keys)].reset_index(drop=True)

    iterative_df = pd.concat(selected_frames, ignore_index=True) if selected_frames else base_df.iloc[0:0].copy()
    # Guarantee exact target when enough edges remain and rounding/user input left a gap.
    if len(iterative_df) < target_count and not remaining.empty:
        extra_needed = min(target_count - len(iterative_df), len(remaining))
        ranked = _rank_with_isolation_forest(remaining, meta["features"], method_id).table
        extra = ranked.head(extra_needed).copy()
        extra_stage = len(stages) + 1
        extra["iterative_stage"] = extra_stage
        iterative_df = pd.concat([iterative_df, extra], ignore_index=True)
        stages.append({
            "stage_index": extra_stage,
            "stage_percent_from_original": round(float(extra_needed / len(base_df) * 100), 4) if len(base_df) else 0.0,
            "stage_target_edges": int(extra_needed),
            "input_table_size": int(len(remaining)),
            "selected_edges": int(len(extra)),
            "cutoff_rank": int(extra_needed),
            "cutoff_score_samples": _round_float(extra[f"{method_id}_if_score_samples"].max()) if not extra.empty else None,
            "score_stats": _score_stats(extra, meta["features"]),
            "score_histograms": _score_histograms(remaining, extra, meta["features"], histogram_edges),
            "model_output_histogram": _model_output_histogram(ranked, extra, method_id),
            "selected_edge_keys": sorted(set(extra["edge_key"].astype(str))),
            "selected_rows": _selected_rows_for_stage(extra, meta["features"], extra_stage, method_id),
            "auto_completion": True,
        })

    metrics = _metric_bundle(original_graph, iterative_df)
    metrics.update({
        "extraction": "iterative",
        "target_percent": target_percent,
        "target_edges": target_count,
        "stage_count": len(stages),
    })
    return iterative_df, stages, metrics


def _method_interpretation(method_id: str, metrics_one: dict, metrics_it: dict, overlap: dict, region_analysis: dict, stage_count: int) -> str:
    label = METHOD_META[method_id]["short"]
    j = overlap["jaccard"]
    unique_it = overlap["only_iterative"]
    reach_delta = round(float(metrics_it["reachability"] - metrics_one["reachability"]), 4)
    comp_delta = int(metrics_it["connected_components"] - metrics_one["connected_components"])
    high = region_analysis.get("high_tail_domination", {})
    delta_high = high.get("delta_pct", 0.0)
    if delta_high < -5:
        tail_sentence = "The iterative run reduced the share of selected edges coming from the strongest score-tail region."
    elif delta_high > 5:
        tail_sentence = "The iterative run still concentrates more strongly in the score-tail region, so the second pass did not reduce tail domination here."
    else:
        tail_sentence = "The iterative and one-shot selections have a similar score-region balance."
    return (
        f"{label} was extracted in {stage_count} progressive stages and compared with the same-size one-shot backbone. "
        f"The final overlap is Jaccard={j}, with {unique_it} iterative-only edges. "
        f"Reachability changed by {reach_delta} and the component count changed by {comp_delta}. "
        f"{tail_sentence}"
    )


def _build_method_result(original_graph: nx.Graph, base_df: pd.DataFrame, method_id: str, target_percent: float, stage_percents: list[float], low_region_percent: float = 10.0, high_region_percent: float = 10.0) -> dict:
    base = base_df.copy().reset_index(drop=True)
    if "edge_key" not in base.columns:
        base["edge_key"] = base.apply(_edge_key_from_row, axis=1)

    one_ranked, one_selected, one_metrics = _one_shot_result(original_graph, base, method_id, target_percent)
    iterative_selected, stages, it_metrics = _iterative_result(original_graph, base, method_id, target_percent, stage_percents)
    sets = _selection_sets(one_selected, iterative_selected)
    overlap = {
        "common": len(sets["common"]),
        "only_one_shot": len(sets["one_shot_only"]),
        "only_iterative": len(sets["iterative_only"]),
        "one_shot_edges": len(sets["one_shot"]),
        "iterative_edges": len(sets["iterative"]),
        "jaccard": _jaccard(sets["one_shot"], sets["iterative"]),
        "common_sample": sorted(sets["common"])[:15],
        "only_iterative_sample": sorted(sets["iterative_only"])[:15],
        "only_one_shot_sample": sorted(sets["one_shot_only"])[:15],
    }
    region_analysis = _region_analysis(base, method_id, one_selected, iterative_selected, stages, low_region_percent, high_region_percent)
    rank_scatter = _rank_scatter(base, method_id, one_ranked, iterative_selected, stages, low_region_percent, high_region_percent)
    feature_scatter = _pa_lp_feature_scatter(base, one_selected, iterative_selected, stages, low_region_percent, high_region_percent) if method_id == "pa_lp" else None
    edge_inspector = _edge_inspector(base, one_ranked, one_selected, iterative_selected, stages, method_id, low_region_percent, high_region_percent)
    graph_overlay = _graph_overlay(original_graph, one_selected, iterative_selected, stages)

    target_edges = _count_from_percent(len(base), target_percent)
    histogram_edges = _histogram_bin_edges(base, METHOD_META[method_id]["features"])
    score_histograms = {
        "one_shot": {
            "label": "One-shot score distribution",
            "input_table_size": int(len(base)),
            "selected_edges": int(len(one_selected)),
            "histograms": _score_histograms(base, one_selected, METHOD_META[method_id]["features"], histogram_edges),
            "model_output_histogram": _model_output_histogram(one_ranked, one_selected, method_id),
        },
        "stages": [
            {
                "stage_index": int(stage["stage_index"]),
                "label": f"Stage {int(stage['stage_index'])} score distribution",
                "input_table_size": int(stage.get("input_table_size", 0)),
                "selected_edges": int(stage.get("selected_edges", 0)),
                "stage_percent_from_original": stage.get("stage_percent_from_original"),
                "histograms": stage.get("score_histograms", []),
                "model_output_histogram": stage.get("model_output_histogram"),
            }
            for stage in stages
        ],
    }
    summary_rows = [
        {
            "extraction": "One-shot",
            "target_percent": target_percent,
            "stages": "—",
            "target_edges": target_edges,
            **one_metrics,
        },
        {
            "extraction": "Iterative",
            "target_percent": target_percent,
            "stages": " + ".join(f"{p:g}%" for p in stage_percents),
            "target_edges": target_edges,
            **it_metrics,
        },
    ]

    return {
        "method_id": method_id,
        "label": METHOD_META[method_id]["label"],
        "short": METHOD_META[method_id]["short"],
        "features": METHOD_META[method_id]["features"],
        "target_percent": target_percent,
        "target_edges": target_edges,
        "stage_percents": stage_percents,
        "region_config": {
            "low_percent": low_region_percent,
            "high_percent": high_region_percent,
            "middle_percent": round(float(max(0.0, 100.0 - low_region_percent - high_region_percent)), 4),
        },
        "summary_rows": summary_rows,
        "one_shot": {
            "metrics": one_metrics,
            "selected_edge_keys": sorted(sets["one_shot"]),
        },
        "iterative": {
            "metrics": it_metrics,
            "selected_edge_keys": sorted(sets["iterative"]),
        },
        "stages": stages,
        "overlap": overlap,
        "region_analysis": region_analysis,
        "score_histograms": score_histograms,
        "rank_scatter": rank_scatter,
        "feature_scatter": feature_scatter,
        "graph_overlay": graph_overlay,
        "edge_inspector": edge_inspector,
        "interpretation": _method_interpretation(method_id, one_metrics, it_metrics, overlap, region_analysis, len(stages)),
    }


def _compare_all(method_results: dict[str, dict]) -> dict:
    entries = []
    sets: dict[str, set[str]] = {}
    for method_id, result in method_results.items():
        for extraction_key, extraction_label in [("one_shot", "One-shot"), ("iterative", "Iterative")]:
            key = f"{method_id}_{extraction_key}"
            metrics = result[extraction_key]["metrics"]
            entries.append({
                "key": key,
                "method_id": method_id,
                "method": result["short"],
                "extraction": extraction_label,
                **metrics,
            })
            sets[key] = set(result[extraction_key]["selected_edge_keys"])

    keys = list(sets.keys())
    matrix = []
    for left in keys:
        row = {"key": left}
        for right in keys:
            row[right] = _jaccard(sets[left], sets[right])
        matrix.append(row)

    region_summary = []
    for method_id, result in method_results.items():
        high = result["region_analysis"]["high_tail_domination"]
        region_summary.append({
            "method_id": method_id,
            "method": result["short"],
            "tail_region": high["region"],
            "one_shot_tail_pct": high["one_shot_pct_of_selected"],
            "iterative_tail_pct": high["iterative_pct_of_selected"],
            "delta_pct": high["delta_pct"],
            "jaccard_with_one_shot": result["overlap"]["jaccard"],
            "iterative_only_edges": result["overlap"]["only_iterative"],
        })

    best_reach = max(entries, key=lambda row: row.get("reachability", 0), default=None)
    most_compact = min(entries, key=lambda row: row.get("node_fraction", 1), default=None)
    interpretation = ""
    if best_reach and most_compact:
        interpretation = (
            f"Across the selected methods, {best_reach['method']} {best_reach['extraction']} has the strongest reachability "
            f"({best_reach['reachability']}). {most_compact['method']} {most_compact['extraction']} keeps the most compact node coverage "
            f"({most_compact['node_fraction']}). The Jaccard matrix shows whether iterative extraction is a small adjustment or a genuinely different backbone."
        )

    return {
        "entries": entries,
        "jaccard_keys": keys,
        "jaccard_matrix": matrix,
        "region_summary": region_summary,
        "interpretation": interpretation,
    }


def run_iterative_extraction_experiment(
    original_graph: nx.Graph,
    scored_df: pd.DataFrame,
    methods: list[str],
    target_percent: float,
    stage_percents: list[float],
    low_region_percent: float = 10.0,
    high_region_percent: float = 10.0,
) -> dict:
    methods = [method for method in methods if method in SUPPORTED_METHODS]
    if not methods:
        raise ValueError("Select at least one supported method: pa, lp, or pa_lp.")
    if not (0 < target_percent <= 100):
        raise ValueError("target_percent must be in (0, 100].")
    if not stage_percents:
        raise ValueError("stage_percents must contain at least one stage.")
    low_region_percent = float(low_region_percent)
    high_region_percent = float(high_region_percent)
    if low_region_percent < 0 or high_region_percent < 0:
        raise ValueError("Low/high score region percentages cannot be negative.")
    if low_region_percent + high_region_percent > 100.0:
        raise ValueError("Low and high score region percentages must sum to 100% or less.")
    total_stage_percent = round(float(sum(stage_percents)), 6)
    if abs(total_stage_percent - float(target_percent)) > 0.01:
        raise ValueError(
            f"Stage percentages must sum to the final target percentage. Got {total_stage_percent:g}% for target {target_percent:g}%."
        )

    base_df = scored_df.copy().reset_index(drop=True)
    required = {"source", "target", PA_COLUMN, LP_COLUMN}
    missing = sorted(required - set(base_df.columns))
    if missing:
        raise ValueError(f"Iterative lab requires PA and LP score columns. Missing: {missing}")
    if "weight" not in base_df.columns:
        base_df["weight"] = 1.0
    base_df["edge_key"] = base_df.apply(_edge_key_from_row, axis=1)

    method_results = {
        method_id: _build_method_result(original_graph, base_df, method_id, target_percent, stage_percents, low_region_percent, high_region_percent)
        for method_id in methods
    }

    original_json = graph_to_json(original_graph, max_edges=None)
    layout = _build_layout_map(original_graph)
    original_json["nodes"] = [
        {**node, "x": layout.get(str(node["id"]), (0.0, 0.0))[0], "y": layout.get(str(node["id"]), (0.0, 0.0))[1]}
        for node in original_json["nodes"]
    ]

    return {
        "selection_rule": "iterative_top_percent_by_isolation_forest_rank",
        "stage_percent_reference": "original_edge_count",
        "supported_methods": list(SUPPORTED_METHODS),
        "target_percent": target_percent,
        "stage_percents": stage_percents,
        "region_percent_reference": "original_score_table",
        "region_config": {
            "low_percent": low_region_percent,
            "high_percent": high_region_percent,
            "middle_percent": round(float(max(0.0, 100.0 - low_region_percent - high_region_percent)), 4),
        },
        "original_edges": int(original_graph.number_of_edges()),
        "original_nodes": int(original_graph.number_of_nodes()),
        "original_graph": original_json,
        "methods": method_results,
        "compare_all": _compare_all(method_results),
    }
