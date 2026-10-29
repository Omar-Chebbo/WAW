from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler, MinMaxScaler

from backend.core.anomaly import (
    anomaly_summary,
    label_anomalies,
    extract_result_dataframe,
    normalize_selection_fraction,
    top_count_from_fraction,
)
from backend.core.evaluation import edge_fraction, node_fraction, number_components, reachability
from backend.services.graph_service import graph_to_json, stable_edge_key


SINGLE_METHOD_IDS = ("pa", "lp")
PA_COLUMN = "preferential_attachment_1"
LP_COLUMN = "local_path_index_1"
MULTI_METHOD_ID = "pa_lp"
MULTI_LABEL = "PA + LP"


@dataclass(frozen=True)
class FeatureRun:
    method_id: str
    label: str
    anomaly_column: str
    selected_edge_keys: list[str]
    selected_node_ids: list[str]
    metrics: dict
    summary: dict



def _edge_key_from_row(row: pd.Series) -> str:
    return stable_edge_key(row["source"], row["target"])



def _prepare_multifeature_matrix(
    df: pd.DataFrame,
    feature_columns: list[str],
    scaling_mode: str = "none",
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """
    Build the PA+LP feature matrix.

    Supported modes:
      - none/raw: raw PA and raw LP
      - minmax: min-max scaling per feature
      - zscore: z-score scaling per feature
      - log: log1p compression per feature
      - log_minmax: log1p then min-max per feature
      - log_zscore: log1p then z-score per feature

    The final backbone selection still uses rank <= top percentage.
    """
    raw = df[feature_columns].astype(float).to_numpy()
    mode = (scaling_mode or "none").strip().lower()
    if mode == "raw":
        mode = "none"

    if mode in {"log", "log_minmax", "log_zscore"}:
        # Use a safe positive shift per feature so signed future scores also work.
        shifted = raw.copy()
        for idx in range(shifted.shape[1]):
            col = shifted[:, idx]
            min_val = np.nanmin(col)
            if min_val < 0:
                col = col - min_val
            shifted[:, idx] = np.log1p(col)
        working = shifted
    else:
        working = raw.copy()

    if mode in {"none", "log"}:
        transformed = working
    elif mode in {"zscore", "log_zscore"}:
        transformed = StandardScaler().fit_transform(working)
    elif mode in {"minmax", "log_minmax"}:
        transformed = MinMaxScaler().fit_transform(working)
    else:
        raise ValueError("Unsupported scaling_mode. Use none, minmax, zscore, log, log_minmax, or log_zscore.")

    per_feature = {
        column: transformed[:, idx].copy()
        for idx, column in enumerate(feature_columns)
    }
    return transformed, per_feature



def _label_multifeature(
    df: pd.DataFrame,
    feature_columns: list[str],
    contamination: float | str = 0.10,
    scaling_mode: str = "none",
    output_prefix: str = MULTI_METHOD_ID,
) -> pd.DataFrame:
    X, transformed_by_feature = _prepare_multifeature_matrix(df, feature_columns, scaling_mode=scaling_mode)
    num_edges = len(df)
    selection_fraction = normalize_selection_fraction(contamination)

    clf = IsolationForest(
        contamination="auto",
        max_samples=num_edges,
        random_state=42,
    )
    clf.fit(X)

    score_samples = clf.score_samples(X).reshape(-1)
    decision_scores = clf.decision_function(X).reshape(-1)

    rank_order = np.argsort(score_samples, kind="mergesort")
    rank = np.empty_like(rank_order)
    rank[rank_order] = np.arange(1, len(score_samples) + 1)

    selected_count = top_count_from_fraction(num_edges, selection_fraction)
    labels = np.where(rank <= selected_count, -1, 1)
    cutoff_score = float(score_samples[rank <= selected_count].max()) if selected_count > 0 else np.nan

    labeled = df.copy()

    # A display-only joint score so generic wizard/inspector pages can treat
    # PA+LP like every other anomaly method. Selection is still based on
    # pa_lp_if_rank, not on this joint score directly.
    joint_score = np.linalg.norm(X, axis=1) if X.size else np.array([])
    labeled[output_prefix] = joint_score
    labeled[f"{output_prefix}_transformed"] = joint_score
    labeled[f"{output_prefix}_normalized"] = (
        MinMaxScaler().fit_transform(joint_score.reshape(-1, 1)).reshape(-1)
        if len(joint_score) else joint_score
    )

    for column in feature_columns:
        labeled[f"{column}_transformed"] = transformed_by_feature[column]

    labeled[f"{output_prefix}_anomaly_score"] = -score_samples
    labeled[f"{output_prefix}_if_score_samples"] = score_samples
    labeled[f"{output_prefix}_if_decision_function"] = decision_scores
    labeled[f"{output_prefix}_if_threshold"] = np.nan
    labeled[f"{output_prefix}_if_contamination"] = selection_fraction
    labeled[f"{output_prefix}_if_selection_fraction"] = selection_fraction
    labeled[f"{output_prefix}_if_selection_count"] = selected_count
    labeled[f"{output_prefix}_if_cutoff_rank"] = selected_count
    labeled[f"{output_prefix}_if_cutoff_score_samples"] = cutoff_score
    labeled[f"{output_prefix}_if_rank"] = rank
    labeled[f"{output_prefix}_anomaly"] = labels
    labeled[f"{output_prefix}_preprocessing"] = scaling_mode or "none"
    labeled[f"{output_prefix}_scaling_mode"] = scaling_mode or "none"
    labeled["edge_key"] = labeled.apply(_edge_key_from_row, axis=1)
    return labeled.sort_values(f"{output_prefix}_if_rank", ascending=True).reset_index(drop=True)



def label_multifeature_edges(
    df: pd.DataFrame,
    contamination: float | str = 0.10,
    scaling_mode: str = "none",
) -> pd.DataFrame:
    """Public helper used by the wizard for PA+LP anomaly ranking."""
    return _label_multifeature(
        df.copy(),
        feature_columns=[PA_COLUMN, LP_COLUMN],
        contamination=contamination,
        scaling_mode=scaling_mode,
        output_prefix=MULTI_METHOD_ID,
    )


def _build_backbone_graph(backbone_df: pd.DataFrame) -> nx.Graph:
    if backbone_df.empty:
        return nx.Graph()
    edge_attr = [col for col in backbone_df.columns if col not in {"source", "target"}]
    return nx.from_pandas_edgelist(backbone_df, source="source", target="target", edge_attr=edge_attr or None)



def _case_metrics(original_graph: nx.Graph, backbone_graph: nx.Graph) -> dict:
    edge_fraction_value, _ = edge_fraction(original_graph, backbone_graph)
    node_fraction_value, _ = node_fraction(original_graph, backbone_graph)
    reachability_value, _ = reachability(original_graph, backbone_graph)
    component_value, _ = number_components(original_graph, backbone_graph)

    return {
        "flagged_edges": int(backbone_graph.number_of_edges()),
        "edge_fraction": round(float(edge_fraction_value), 6),
        "node_fraction": round(float(node_fraction_value), 6),
        "reachability": round(float(reachability_value), 6),
        "connected_components": int(component_value),
        "retained_nodes": int(backbone_graph.number_of_nodes()),
    }



def _selected_entities(backbone_df: pd.DataFrame) -> tuple[list[str], list[str]]:
    if backbone_df.empty:
        return [], []
    edge_keys = sorted(stable_edge_key(row["source"], row["target"]) for _, row in backbone_df.iterrows())
    node_ids = sorted({str(row["source"]) for _, row in backbone_df.iterrows()} | {str(row["target"]) for _, row in backbone_df.iterrows()})
    return edge_keys, node_ids



def _run_single_feature_case(
    original_graph: nx.Graph,
    scored_df: pd.DataFrame,
    method_id: str,
    contamination: float | str,
) -> tuple[FeatureRun, pd.DataFrame]:
    column = PA_COLUMN if method_id == "pa" else LP_COLUMN
    result = label_anomalies(scored_df.copy(), column, transform_id="raw", contamination=contamination)
    labeled = extract_result_dataframe(result)
    anomaly_col = f"{column}_anomaly"
    backbone_df = labeled.loc[labeled[anomaly_col] == -1].copy()
    backbone_graph = _build_backbone_graph(backbone_df)
    selected_edge_keys, selected_node_ids = _selected_entities(backbone_df)

    run = FeatureRun(
        method_id=method_id,
        label="PA" if method_id == "pa" else "LP",
        anomaly_column=anomaly_col,
        selected_edge_keys=selected_edge_keys,
        selected_node_ids=selected_node_ids,
        metrics=_case_metrics(original_graph, backbone_graph),
        summary=anomaly_summary(labeled, column),
    )
    return run, labeled



def _run_multifeature_case(
    original_graph: nx.Graph,
    scored_df: pd.DataFrame,
    contamination: float | str,
    scaling_mode: str,
) -> tuple[FeatureRun, pd.DataFrame]:
    labeled = _label_multifeature(
        scored_df.copy(),
        feature_columns=[PA_COLUMN, LP_COLUMN],
        contamination=contamination,
        scaling_mode=scaling_mode,
        output_prefix=MULTI_METHOD_ID,
    )
    anomaly_col = f"{MULTI_METHOD_ID}_anomaly"
    backbone_df = labeled.loc[labeled[anomaly_col] == -1].copy()
    backbone_graph = _build_backbone_graph(backbone_df)
    selected_edge_keys, selected_node_ids = _selected_entities(backbone_df)

    run = FeatureRun(
        method_id=MULTI_METHOD_ID,
        label=MULTI_LABEL,
        anomaly_column=anomaly_col,
        selected_edge_keys=selected_edge_keys,
        selected_node_ids=selected_node_ids,
        metrics=_case_metrics(original_graph, backbone_graph),
        summary={
            "flagged": int((labeled[anomaly_col] == -1).sum()),
            "total": int(len(labeled)),
            "pct": round(float((labeled[anomaly_col] == -1).mean() * 100), 1) if len(labeled) else 0.0,
            "selected_transform": scaling_mode,
            "threshold": None,
            "selection_fraction": normalize_selection_fraction(contamination),
            "selection_count": int(labeled[f"{MULTI_METHOD_ID}_if_selection_count"].iloc[0]) if len(labeled) else 0,
            "cutoff_rank": int(labeled[f"{MULTI_METHOD_ID}_if_cutoff_rank"].iloc[0]) if len(labeled) else 0,
            "cutoff_score_samples": round(float(labeled[f"{MULTI_METHOD_ID}_if_cutoff_score_samples"].iloc[0]), 6) if len(labeled) else None,
            "contamination": normalize_selection_fraction(contamination),
        },
    )
    return run, labeled



def _extreme_rows(table_df: pd.DataFrame, primary_score_column: str, high_region_pct: float = 0.10, low_region_pct: float = 0.10) -> dict:
    primary_anomaly_col = f"{primary_score_column}_anomaly"

    region_config = {"high_pct": high_region_pct, "low_pct": low_region_pct, "middle_pct": round(1 - high_region_pct - low_region_pct, 4)}

    ordered = table_df.sort_values(primary_score_column, ascending=True).copy()
    total = len(ordered)
    if total == 0:
        return {
            "lowest": [],
            "highest": [],
            "selection_balance": {"top_10_pct": 0.0, "bottom_10_pct": 0.0, "middle_80_pct": 0.0, "region_config": region_config},
        }

    def _safe_int(value) -> int | None:
        return None if pd.isna(value) else int(value)

    def _safe_float(value) -> float | None:
        return None if pd.isna(value) else round(float(value), 6)

    def _rows(frame: pd.DataFrame) -> list[dict]:
        result = []
        for _, row in frame.iterrows():
            result.append(
                {
                    "source": str(row["source"]),
                    "target": str(row["target"]),
                    "edge_key": stable_edge_key(row["source"], row["target"]),
                    "score": round(float(row[primary_score_column]), 6),
                    "pa_score": round(float(row[PA_COLUMN]), 6),
                    "lp_score": round(float(row[LP_COLUMN]), 6),
                    "selected": bool(row[primary_anomaly_col] == -1),
                    "selected_by_pa": bool(row.get(f"{PA_COLUMN}_anomaly", 1) == -1),
                    "selected_by_lp": bool(row.get(f"{LP_COLUMN}_anomaly", 1) == -1),
                    "selected_by_pa_lp": bool(row.get(f"{MULTI_METHOD_ID}_anomaly", 1) == -1),
                    "rank": _safe_int(row.get(f"{primary_score_column}_if_rank")),
                    "pa_rank": _safe_int(row.get(f"{PA_COLUMN}_if_rank")),
                    "lp_rank": _safe_int(row.get(f"{LP_COLUMN}_if_rank")),
                    "pa_lp_rank": _safe_int(row.get(f"{MULTI_METHOD_ID}_if_rank")),
                    "decision_function": _safe_float(row.get(f"{primary_score_column}_if_decision_function")),
                    "score_samples": _safe_float(row.get(f"{primary_score_column}_if_score_samples")),
                }
            )
        return result

    lowest = _rows(ordered)
    highest = _rows(ordered.sort_values(primary_score_column, ascending=False))

    anomaly_mask = ordered[primary_anomaly_col] == -1
    bottom_cut = max(1, int(np.ceil(total * low_region_pct)))
    top_cut = max(1, int(np.ceil(total * high_region_pct)))
    bottom_idx = ordered.index[:bottom_cut]
    top_idx = ordered.index[-top_cut:]
    middle_idx = ordered.index[bottom_cut:-top_cut] if total > (bottom_cut + top_cut) else ordered.index[0:0]

    flagged_total = int(anomaly_mask.sum())

    top_count = int((ordered.loc[top_idx, primary_anomaly_col] == -1).sum())
    bottom_count = int((ordered.loc[bottom_idx, primary_anomaly_col] == -1).sum())
    middle_count = int((ordered.loc[middle_idx, primary_anomaly_col] == -1).sum()) if len(middle_idx) else 0

    if flagged_total == 0:
        balance = {
            "top_10_pct": 0.0,
            "bottom_10_pct": 0.0,
            "middle_80_pct": 0.0,
            "top_10_count": 0,
            "bottom_10_count": 0,
            "middle_80_count": 0,
            "selected_total": 0,
            "region_config": region_config,
        }
    else:
        balance = {
            "top_10_pct": round(float(top_count / flagged_total * 100), 2),
            "bottom_10_pct": round(float(bottom_count / flagged_total * 100), 2),
            "middle_80_pct": round(float(middle_count / flagged_total * 100), 2),
            "top_10_count": top_count,
            "bottom_10_count": bottom_count,
            "middle_80_count": middle_count,
            "selected_total": flagged_total,
            "region_config": region_config,
        }

    return {
        "lowest": lowest,
        "highest": highest,
        "selection_balance": balance,
    }




def _region_masks(df: pd.DataFrame, column: str, high_region_pct: float = 0.10, low_region_pct: float = 0.10) -> dict[str, pd.Series]:
    """Split a score column into bottom, middle, and top regions by customisable percentages.

    The split is rank-based rather than threshold-only, so ties at zero do not
    accidentally make the bottom region much larger than expected.
    """
    total = len(df)
    if total == 0:
        empty = pd.Series(False, index=df.index)
        return {"low": empty, "middle": empty, "high": empty}

    ordered = df.sort_values(column, ascending=True)
    low_cut = max(1, int(np.ceil(total * low_region_pct)))
    high_cut = max(1, int(np.ceil(total * high_region_pct)))
    low_idx = ordered.index[:low_cut]
    high_idx = ordered.index[-high_cut:]

    low = df.index.isin(low_idx)
    high = df.index.isin(high_idx)
    middle = ~(low | high)

    return {
        "low": pd.Series(low, index=df.index),
        "middle": pd.Series(middle, index=df.index),
        "high": pd.Series(high, index=df.index),
    }


def _score_balance_for_multifeature(df: pd.DataFrame, column: str, selected_mask: pd.Series, high_region_pct: float = 0.10, low_region_pct: float = 0.10) -> dict:
    region_config = {"high_pct": high_region_pct, "low_pct": low_region_pct, "middle_pct": round(1 - high_region_pct - low_region_pct, 4)}
    masks = _region_masks(df, column, high_region_pct=high_region_pct, low_region_pct=low_region_pct)
    selected_total = int(selected_mask.sum())

    def count(region: str) -> int:
        return int((selected_mask & masks[region]).sum())

    low_count = count("low")
    middle_count = count("middle")
    high_count = count("high")

    def pct(value: int) -> float:
        return round(float(value / selected_total * 100), 2) if selected_total else 0.0

    return {
        "top_10_pct": pct(high_count),
        "bottom_10_pct": pct(low_count),
        "middle_80_pct": pct(middle_count),
        "top_10_count": high_count,
        "bottom_10_count": low_count,
        "middle_80_count": middle_count,
        "selected_total": selected_total,
        "region_config": region_config,
    }


def _multi_feature_profile(df: pd.DataFrame, high_region_pct: float = 0.10, low_region_pct: float = 0.10) -> dict:
    """Describe what score regions the PA+LP backbone selected from."""
    anomaly_col = f"{MULTI_METHOD_ID}_anomaly"
    selected_mask = df[anomaly_col] == -1
    selected_total = int(selected_mask.sum())

    pa_regions = _region_masks(df, PA_COLUMN, high_region_pct=high_region_pct, low_region_pct=low_region_pct)
    lp_regions = _region_masks(df, LP_COLUMN, high_region_pct=high_region_pct, low_region_pct=low_region_pct)
    order = ["low", "middle", "high"]

    joint_grid = []
    for pa_region in order:
        for lp_region in order:
            zone_mask = pa_regions[pa_region] & lp_regions[lp_region]
            selected_count = int((selected_mask & zone_mask).sum())
            total_count = int(zone_mask.sum())
            pct_of_selected = round(float(selected_count / selected_total * 100), 2) if selected_total else 0.0
            joint_grid.append({
                "pa_region": pa_region,
                "lp_region": lp_region,
                "selected_count": selected_count,
                "total_count": total_count,
                "pct_of_selected": pct_of_selected,
            })

    return {
        "selected_total": selected_total,
        "pa_score_balance": _score_balance_for_multifeature(df, PA_COLUMN, selected_mask, high_region_pct=high_region_pct, low_region_pct=low_region_pct),
        "lp_score_balance": _score_balance_for_multifeature(df, LP_COLUMN, selected_mask, high_region_pct=high_region_pct, low_region_pct=low_region_pct),
        "joint_grid": joint_grid,
    }

def _edge_jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    left_set = set(left)
    right_set = set(right)
    union = left_set | right_set
    if not union:
        return 1.0
    return round(len(left_set & right_set) / len(union), 6)



def _node_jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    left_set = set(left)
    right_set = set(right)
    union = left_set | right_set
    if not union:
        return 1.0
    return round(len(left_set & right_set) / len(union), 6)



def compute_multifeature_novelty(
    pa_edge_keys: Iterable[str],
    lp_edge_keys: Iterable[str],
    multi_edge_keys: Iterable[str],
) -> dict:
    """The single source of truth for the Multi-Feature Study novelty N_rho.

    N_rho = cardinality of (joint edges excluding PA-or-LP edges) / joint edge count.
    The novelty is undefined if the joint backbone has no selected edges.
    """
    pa = set(pa_edge_keys)
    lp = set(lp_edge_keys)
    joint = set(multi_edge_keys)
    unique = joint - (pa | lp)
    return {
        "value": len(unique) / len(joint) if joint else None,
        "novel_edges": len(unique),
        "multi_edges": len(joint),
        "novel_edge_keys": sorted(unique),
    }


def _common_unique_summary(pa_run: FeatureRun, lp_run: FeatureRun, multi_run: FeatureRun) -> dict:
    edge_sets = {
        pa_run.method_id: set(pa_run.selected_edge_keys),
        lp_run.method_id: set(lp_run.selected_edge_keys),
        multi_run.method_id: set(multi_run.selected_edge_keys),
    }
    node_sets = {
        pa_run.method_id: set(pa_run.selected_node_ids),
        lp_run.method_id: set(lp_run.selected_node_ids),
        multi_run.method_id: set(multi_run.selected_node_ids),
    }

    common_edges = sorted(edge_sets["pa"] & edge_sets["lp"] & edge_sets[MULTI_METHOD_ID])
    common_nodes = sorted(node_sets["pa"] & node_sets["lp"] & node_sets[MULTI_METHOD_ID])

    unique_edges = {
        key: sorted(value - set().union(*(edge_sets[other] for other in edge_sets if other != key)))
        for key, value in edge_sets.items()
    }
    unique_nodes = {
        key: sorted(value - set().union(*(node_sets[other] for other in node_sets if other != key)))
        for key, value in node_sets.items()
    }

    # Reuse the same definition as the Contamination Lab at every retention.
    novelty = compute_multifeature_novelty(
        edge_sets["pa"], edge_sets["lp"], edge_sets[MULTI_METHOD_ID]
    )

    return {
        "multifeature_novelty": {key: novelty[key] for key in ("value", "novel_edges", "multi_edges")},
        "edges": {
            "common_to_all": {"count": len(common_edges), "sample": common_edges[:15]},
            "unique": {key: {"count": len(value), "sample": value[:15]} for key, value in unique_edges.items()},
            "pairwise_jaccard": {
                "pa_vs_lp": _edge_jaccard(pa_run.selected_edge_keys, lp_run.selected_edge_keys),
                "pa_vs_pa_lp": _edge_jaccard(pa_run.selected_edge_keys, multi_run.selected_edge_keys),
                "lp_vs_pa_lp": _edge_jaccard(lp_run.selected_edge_keys, multi_run.selected_edge_keys),
            },
        },
        "nodes": {
            "common_to_all": {"count": len(common_nodes), "sample": common_nodes[:15]},
            "unique": {key: {"count": len(value), "sample": value[:15]} for key, value in unique_nodes.items()},
            "pairwise_jaccard": {
                "pa_vs_lp": _node_jaccard(pa_run.selected_node_ids, lp_run.selected_node_ids),
                "pa_vs_pa_lp": _node_jaccard(pa_run.selected_node_ids, multi_run.selected_node_ids),
                "lp_vs_pa_lp": _node_jaccard(lp_run.selected_node_ids, multi_run.selected_node_ids),
            },
        },
    }



def _quadrant_counts(df: pd.DataFrame, anomaly_col: str) -> list[dict]:
    pa_median = float(df[PA_COLUMN].median())
    lp_median = float(df[LP_COLUMN].median())

    quadrants = {
        "high_pa_high_lp": ((df[PA_COLUMN] >= pa_median) & (df[LP_COLUMN] >= lp_median)),
        "high_pa_low_lp": ((df[PA_COLUMN] >= pa_median) & (df[LP_COLUMN] < lp_median)),
        "low_pa_high_lp": ((df[PA_COLUMN] < pa_median) & (df[LP_COLUMN] >= lp_median)),
        "low_pa_low_lp": ((df[PA_COLUMN] < pa_median) & (df[LP_COLUMN] < lp_median)),
    }

    result = []
    for label, mask in quadrants.items():
        total = int(mask.sum())
        selected = int(((df[anomaly_col] == -1) & mask).sum())
        result.append({"quadrant": label, "total": total, "selected": selected})
    return result



def _scatter_3d_points(merged_df: pd.DataFrame, backbone_contamination: float = 0.20) -> dict:
    """Build 3D scatter data: PA anomaly score (x), LP anomaly score (y), PA+LP anomaly score (z).

    The backbone membership is determined by the PA+LP method at the given contamination.
    We use the existing rank-based selection: rank <= top_count means backbone.
    """
    total = len(merged_df)
    if total == 0:
        return {"points": [], "backbone_count": 0, "non_backbone_count": 0, "backbone_contamination": backbone_contamination}

    pa_col = f"{PA_COLUMN}_if_score_samples"
    lp_col = f"{LP_COLUMN}_if_score_samples"
    multi_col = f"{MULTI_METHOD_ID}_if_score_samples"
    multi_rank_col = f"{MULTI_METHOD_ID}_if_rank"

    # Determine backbone membership at the given contamination
    selection_fraction = normalize_selection_fraction(backbone_contamination)
    selected_count = top_count_from_fraction(total, selection_fraction)

    points = []
    backbone_count = 0
    non_backbone_count = 0

    for _, row in merged_df.iterrows():
        is_backbone = int(row.get(multi_rank_col, total + 1)) <= selected_count
        if is_backbone:
            backbone_count += 1
        else:
            non_backbone_count += 1

        points.append({
            "source": str(row["source"]),
            "target": str(row["target"]),
            "edge_key": stable_edge_key(row["source"], row["target"]),
            "x": round(float(row.get(pa_col, 0)), 6),  # PA anomaly score
            "y": round(float(row.get(lp_col, 0)), 6),  # LP anomaly score
            "z": round(float(row.get(multi_col, 0)), 6),  # PA+LP anomaly score
            "is_backbone": is_backbone,
            "pa_rank": int(row.get(f"{PA_COLUMN}_if_rank", 0)),
            "lp_rank": int(row.get(f"{LP_COLUMN}_if_rank", 0)),
            "pa_lp_rank": int(row.get(f"{MULTI_METHOD_ID}_if_rank", 0)),
        })

    return {
        "points": points,
        "backbone_count": backbone_count,
        "non_backbone_count": non_backbone_count,
        "backbone_contamination": backbone_contamination,
    }


def _scatter_points(merged_df: pd.DataFrame) -> list[dict]:
    points = []
    for _, row in merged_df.iterrows():
        points.append(
            {
                "source": str(row["source"]),
                "target": str(row["target"]),
                "edge_key": stable_edge_key(row["source"], row["target"]),
                "pa": round(float(row[PA_COLUMN]), 6),
                "lp": round(float(row[LP_COLUMN]), 6),
                "selected_by_pa": bool(row.get(f"{PA_COLUMN}_anomaly", 1) == -1),
                "selected_by_lp": bool(row.get(f"{LP_COLUMN}_anomaly", 1) == -1),
                "selected_by_pa_lp": bool(row.get(f"{MULTI_METHOD_ID}_anomaly", 1) == -1),
            }
        )
    return points



def _compute_layout_map(graph: nx.Graph) -> dict[str, tuple[float, float]]:
    layout = nx.spring_layout(graph, seed=42, weight="weight")
    return {str(node): (float(position[0]), float(position[1])) for node, position in layout.items()}



def _graph_json_with_layout(graph: nx.Graph, layout_map: dict[str, tuple[float, float]]) -> dict:
    payload = graph_to_json(graph, max_edges=None)
    positioned_nodes = []
    for node in payload["nodes"]:
        node_id = str(node["id"])
        x, y = layout_map.get(node_id, (0.0, 0.0))
        positioned_nodes.append({**node, "x": x, "y": y})
    payload["nodes"] = positioned_nodes
    return payload



def _interpretation(pa_run: FeatureRun, lp_run: FeatureRun, multi_run: FeatureRun, overlap: dict) -> str:
    best_reachability = max(
        [(pa_run.label, pa_run.metrics["reachability"]), (lp_run.label, lp_run.metrics["reachability"]), (multi_run.label, multi_run.metrics["reachability"])],
        key=lambda item: item[1],
    )[0]
    smallest_backbone = min(
        [(pa_run.label, pa_run.metrics["edge_fraction"]), (lp_run.label, lp_run.metrics["edge_fraction"]), (multi_run.label, multi_run.metrics["edge_fraction"])],
        key=lambda item: item[1],
    )[0]
    pa_lp_unique = overlap["edges"]["unique"][MULTI_METHOD_ID]["count"]
    return (
        f"{best_reachability} preserves the strongest connectivity in this run. "
        f"{smallest_backbone} is the most compact backbone. "
        f"The multi-feature backbone contributes {pa_lp_unique} edges that neither single-feature backbone selected, "
        f"which helps judge whether the added PA+LP complexity is giving genuinely new structural information."
    )



def run_multi_feature_experiment(
    original_graph: nx.Graph,
    scored_df: pd.DataFrame,
    contamination: float | str = "auto",
    scaling_mode: str = "none",
    high_region_pct: float = 0.10,
    low_region_pct: float = 0.10,
) -> dict:
    if high_region_pct + low_region_pct >= 1.0:
        raise ValueError("high_region_pct + low_region_pct must be less than 1.0")
    high_region_pct = max(0.0, min(0.49, high_region_pct))
    low_region_pct = max(0.0, min(0.49, low_region_pct))

    pa_run, pa_labeled = _run_single_feature_case(original_graph, scored_df, "pa", contamination)
    lp_run, lp_labeled = _run_single_feature_case(original_graph, scored_df, "lp", contamination)
    multi_run, multi_labeled = _run_multifeature_case(original_graph, scored_df, contamination, scaling_mode)

    merged = scored_df[["source", "target", "weight", PA_COLUMN, LP_COLUMN]].copy()
    merged = merged.merge(
        pa_labeled[["source", "target", f"{PA_COLUMN}_anomaly", f"{PA_COLUMN}_if_rank", f"{PA_COLUMN}_if_decision_function", f"{PA_COLUMN}_if_score_samples"]],
        on=["source", "target"],
        how="left",
    )
    merged = merged.merge(
        lp_labeled[["source", "target", f"{LP_COLUMN}_anomaly", f"{LP_COLUMN}_if_rank", f"{LP_COLUMN}_if_decision_function", f"{LP_COLUMN}_if_score_samples"]],
        on=["source", "target"],
        how="left",
    )
    merged = merged.merge(
        multi_labeled[["source", "target", f"{MULTI_METHOD_ID}_anomaly", f"{MULTI_METHOD_ID}_if_rank", f"{MULTI_METHOD_ID}_if_decision_function", f"{MULTI_METHOD_ID}_if_score_samples"]],
        on=["source", "target"],
        how="left",
    )
    merged["edge_key"] = merged.apply(_edge_key_from_row, axis=1)

    layout_map = _compute_layout_map(original_graph)
    original_graph_json = _graph_json_with_layout(original_graph, layout_map)

    overlap = _common_unique_summary(pa_run, lp_run, multi_run)

    selection_fraction = normalize_selection_fraction(contamination)

    return {
        "feature_columns": [PA_COLUMN, LP_COLUMN],
        "contamination": selection_fraction,
        "selection_rule": "top_percent_by_isolation_forest_rank",
        "scaling_mode": scaling_mode,
        "original_graph": original_graph_json,
        "cases": {
            "pa": {
                "method_id": pa_run.method_id,
                "label": pa_run.label,
                "metrics": pa_run.metrics,
                "summary": pa_run.summary,
                "selected_edge_keys": pa_run.selected_edge_keys,
                "selected_node_ids": pa_run.selected_node_ids,
                "extremes": _extreme_rows(merged, PA_COLUMN, high_region_pct=high_region_pct, low_region_pct=low_region_pct),
            },
            "lp": {
                "method_id": lp_run.method_id,
                "label": lp_run.label,
                "metrics": lp_run.metrics,
                "summary": lp_run.summary,
                "selected_edge_keys": lp_run.selected_edge_keys,
                "selected_node_ids": lp_run.selected_node_ids,
                "extremes": _extreme_rows(merged, LP_COLUMN, high_region_pct=high_region_pct, low_region_pct=low_region_pct),
            },
            MULTI_METHOD_ID: {
                "method_id": multi_run.method_id,
                "label": multi_run.label,
                "metrics": multi_run.metrics,
                "summary": multi_run.summary,
                "selected_edge_keys": multi_run.selected_edge_keys,
                "selected_node_ids": multi_run.selected_node_ids,
            },
        },
        "multi_feature_profile": _multi_feature_profile(merged, high_region_pct=high_region_pct, low_region_pct=low_region_pct),
        "scatter": {
            "points": _scatter_points(merged),
            "quadrant_counts": _quadrant_counts(merged, f"{MULTI_METHOD_ID}_anomaly"),
        },
        "scatter_3d": _scatter_3d_points(merged, backbone_contamination=0.20),
        "region_config": {"high_pct": high_region_pct, "low_pct": low_region_pct, "middle_pct": round(1 - high_region_pct - low_region_pct, 4)},
        "overlap": overlap,
        "interpretation": _interpretation(pa_run, lp_run, multi_run, overlap),
    }
