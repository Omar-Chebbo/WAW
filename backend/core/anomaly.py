"""
backend/core/anomaly.py
Pure-function anomaly ranking and labeling — no file I/O here.
The service layer handles reading/writing files.

New contamination logic:
Isolation Forest produces a sorted abnormality ranking. Contamination is the
percentage of that ranking kept as the backbone. No sklearn threshold/predict
cutoff is used to choose backbone edges.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import MinMaxScaler

from backend.core.preprocessing import apply_transformation, choose_preprocessing

try:  # pragma: no cover - runtime dependency may be absent in some dev environments
    from netbone.backbone import Backbone  # type: ignore
    from netbone.filters import fraction_filter, threshold_filter  # type: ignore
except Exception:  # pragma: no cover
    class Backbone:  # lightweight fallback so the project still runs without netbone installed
        def __init__(
            self,
            graph: nx.Graph,
            method_name: str | None = None,
            property_name: str | None = None,
            ascending: bool | None = None,
            compatible_filters: list[Any] | None = None,
            filter_on: str | None = None,
        ) -> None:
            self.graph = graph
            self.method_name = method_name
            self.property_name = property_name
            self.ascending = ascending
            self.compatible_filters = compatible_filters or []
            self.filter_on = filter_on

    def threshold_filter(*args, **kwargs):
        return None

    def fraction_filter(*args, **kwargs):
        return None


DEFAULT_SELECTION_FRACTION = 0.10


@dataclass
class AnomalyLabelResult:
    """
    Dual result for anomaly labeling.

    - `data` keeps the full labeled DataFrame used by the current app UI/workflow.
    - `backbone` keeps the graph-native Backbone object introduced by the refactor.
    """

    data: pd.DataFrame
    backbone: Backbone | None

    def to_dataframe(self) -> pd.DataFrame:
        return self.data

    def to_csv(self, *args, **kwargs):
        return self.data.to_csv(*args, **kwargs)

    @property
    def loc(self):
        return self.data.loc

    @property
    def iloc(self):
        return self.data.iloc

    @property
    def columns(self):
        return self.data.columns

    @property
    def shape(self):
        return self.data.shape

    def copy(self, *args, **kwargs):
        return self.data.copy(*args, **kwargs)

    def __len__(self):
        return len(self.data)

    def __getitem__(self, key):
        return self.data.__getitem__(key)

    def __setitem__(self, key, value):
        self.data.__setitem__(key, value)

    def __iter__(self):
        return iter(self.data)

    def __contains__(self, item):
        return item in self.data

    def __getattr__(self, name: str):
        return getattr(self.data, name)


DataLike = pd.DataFrame | AnomalyLabelResult


def _to_builtin_scalar(value: Any) -> Any:
    if isinstance(value, (np.floating, float)):
        return float(value)
    if isinstance(value, (np.integer, int)):
        return int(value)
    return value


def extract_result_dataframe(result: DataLike) -> pd.DataFrame:
    if isinstance(result, AnomalyLabelResult):
        return result.data
    return result


def extract_result_backbone(result: DataLike) -> Backbone | None:
    if isinstance(result, AnomalyLabelResult):
        return result.backbone
    return None


def normalize_selection_fraction(contamination: float | str | None = None) -> float:
    """
    Interpret contamination as the fraction of top-ranked anomalous edges kept.

    Examples:
      - 0.10 keeps the top 10% of edges in the anomaly ranking.
      - 0.25 keeps the top 25%.
      - None / "auto" are kept for backwards compatibility and map to 0.10.
    """
    if contamination is None:
        return DEFAULT_SELECTION_FRACTION

    if isinstance(contamination, str):
        token = contamination.strip().lower()
        if token in {"", "auto", "default"}:
            return DEFAULT_SELECTION_FRACTION
        try:
            value = float(token)
        except ValueError as exc:
            raise ValueError(
                f"Unsupported contamination value '{contamination}'. Use a fraction in (0, 1], e.g. 0.25 for top 25%."
            ) from exc
    else:
        value = float(contamination)

    if not (0 < value <= 1):
        raise ValueError(
            f"Contamination '{contamination}' is invalid. In the new ranking logic it must be a fraction in (0, 1]."
        )
    return value


def top_count_from_fraction(total: int, fraction: float) -> int:
    if total <= 0:
        return 0
    return max(1, min(total, int(np.ceil(total * fraction))))


def _build_backbone_object(data: pd.DataFrame, column: str) -> Backbone | None:
    graph = nx.from_pandas_edgelist(
        data,
        source="source",
        target="target",
        edge_attr=True,
    )

    backbone = Backbone(
        graph,
        method_name="Anomaly Backbone",
        property_name=f"{column}_if_score_samples",
        ascending=True,
        compatible_filters=[threshold_filter, fraction_filter],
        filter_on="Edges",
    )

    try:
        setattr(backbone, "labeled_data", data.copy())
    except Exception:
        pass

    return backbone


def apply_top_fraction_selection(data: pd.DataFrame, column: str, contamination: float | str | None = None) -> pd.DataFrame:
    """
    Apply the new backbone rule to an already scored/ranked Isolation Forest table.

    The Isolation Forest ranking is the source of truth. Contamination is only
    the percentage of this sorted ranking retained as the backbone.
    """
    rank_col = f"{column}_if_rank"
    score_col = f"{column}_if_score_samples"
    anomaly_col = f"{column}_anomaly"

    if rank_col not in data.columns:
        raise ValueError(f"Missing Isolation Forest rank column: {rank_col}")

    fraction = normalize_selection_fraction(contamination)
    selected_count = top_count_from_fraction(len(data), fraction)

    labeled = data.copy()
    selected_mask = labeled[rank_col].astype(float) <= selected_count
    labeled[anomaly_col] = np.where(selected_mask, -1, 1)
    labeled[f"{column}_if_contamination"] = fraction
    labeled[f"{column}_if_selection_fraction"] = fraction
    labeled[f"{column}_if_selection_count"] = selected_count
    labeled[f"{column}_if_cutoff_rank"] = selected_count

    if score_col in labeled.columns and selected_count > 0 and selected_mask.any():
        cutoff_score = float(labeled.loc[selected_mask, score_col].max())
    else:
        cutoff_score = np.nan
    labeled[f"{column}_if_cutoff_score_samples"] = cutoff_score

    # Old column kept only for compatibility. It is no longer used for selection.
    labeled[f"{column}_if_threshold"] = np.nan

    return labeled.sort_values(rank_col, ascending=True).reset_index(drop=True)


def label_anomalies(
    data: pd.DataFrame,
    column: str,
    transform_id: str | None = None,
    contamination: float | str | None = None,
) -> AnomalyLabelResult:
    """
    Rank edges by Isolation Forest abnormality, then keep the top contamination percentage.

    New project logic:
      1. Fit Isolation Forest once on the transformed PA/LP score vector.
      2. Store score_samples for every edge.
      3. Sort/rank edges by score_samples ascending (rank 1 = most anomalous).
      4. Interpret contamination as the backbone percentage.
         Example: contamination=0.25 keeps the top 25% ranked edges.
    """

    scores = data[column].to_numpy(dtype=float)
    num_edges = len(data)

    decision = choose_preprocessing(scores)
    selected_transform = transform_id or decision["selected_transform"]

    transformed = apply_transformation(scores, selected_transform)
    normalized = MinMaxScaler().fit_transform(transformed.reshape(-1, 1)).reshape(-1)

    X = transformed.reshape(-1, 1)

    # Fit once. The model contamination/threshold is not used for backbone selection.
    clf = IsolationForest(
        contamination="auto",
        max_samples=num_edges,
        random_state=42,
    )
    clf.fit(X)

    score_samples = clf.score_samples(X).reshape(-1)
    decision_scores = clf.decision_function(X).reshape(-1)

    # Lower score_samples = more abnormal in scikit-learn Isolation Forest.
    rank_order = np.argsort(score_samples, kind="mergesort")
    rank = np.empty_like(rank_order)
    rank[rank_order] = np.arange(1, len(score_samples) + 1)

    labeled = data.copy()
    labeled[f"{column}_transformed"] = transformed
    labeled[f"{column}_normalized"] = normalized
    labeled[f"{column}_anomaly_score"] = -score_samples  # higher = more anomalous
    labeled[f"{column}_if_score_samples"] = score_samples
    labeled[f"{column}_if_decision_function"] = decision_scores
    labeled[f"{column}_if_rank"] = rank
    labeled[f"{column}_preprocessing"] = selected_transform
    labeled[f"{column}_shape_class"] = decision["shape_class"]
    labeled[f"{column}_distribution_skewness"] = decision["decision_features"]["skewness"]
    labeled[f"{column}_zero_ratio"] = decision["decision_features"]["zero_ratio"]

    labeled = apply_top_fraction_selection(labeled, column, contamination)

    backbone = _build_backbone_object(labeled, column)
    return AnomalyLabelResult(data=labeled, backbone=backbone)


def label_anomalies_with_percentile(
    data: DataLike, column: str, percentile: float
) -> pd.DataFrame:
    """
    Backward-compatible relabel endpoint.

    `percentile` is now interpreted as the percentage of the anomaly ranking to
    keep, not as a threshold on normalized raw scores.
    Example: percentile=25 keeps the top 25% most anomalous edges.
    """
    data = extract_result_dataframe(data)
    rank_col = f"{column}_if_rank"

    fraction = float(percentile) / 100.0
    if rank_col not in data.columns:
        data = extract_result_dataframe(label_anomalies(data, column, contamination=fraction))

    return apply_top_fraction_selection(data, column, fraction)


def anomaly_summary(data: DataLike, column: str) -> dict:
    data = extract_result_dataframe(data)
    anomaly_col = f"{column}_anomaly"
    if anomaly_col not in data.columns:
        return {
            "flagged": 0,
            "total": len(data),
            "pct": 0.0,
            "score_min": 0,
            "score_max": 0,
            "score_mean": 0,
            "selected_transform": None,
            "threshold": None,
            "selection_fraction": None,
            "selection_count": None,
            "cutoff_rank": None,
            "cutoff_score_samples": None,
            "contamination": None,
            "distribution_skewness": None,
        }

    flagged = int((data[anomaly_col] == -1).sum())
    total = len(data)
    pct = round(flagged / total * 100, 1) if total > 0 else 0.0

    norm_col = f"{column}_normalized"
    backbone_scores = (
        data.loc[data[anomaly_col] == -1, norm_col].values
        if norm_col in data.columns
        else np.array([])
    )

    preprocess_col = f"{column}_preprocessing"
    selected_transform = (
        str(data[preprocess_col].iloc[0])
        if preprocess_col in data.columns and len(data) > 0
        else None
    )

    threshold = None
    threshold_col = f"{column}_if_threshold"
    if threshold_col in data.columns and len(data) > 0:
        raw_threshold = data[threshold_col].iloc[0]
        if not pd.isna(raw_threshold):
            threshold = float(raw_threshold)

    selection_fraction_col = f"{column}_if_selection_fraction"
    selection_fraction = (
        _to_builtin_scalar(data[selection_fraction_col].iloc[0])
        if selection_fraction_col in data.columns and len(data) > 0
        else None
    )

    selection_count_col = f"{column}_if_selection_count"
    selection_count = (
        _to_builtin_scalar(data[selection_count_col].iloc[0])
        if selection_count_col in data.columns and len(data) > 0
        else None
    )

    cutoff_rank_col = f"{column}_if_cutoff_rank"
    cutoff_rank = (
        _to_builtin_scalar(data[cutoff_rank_col].iloc[0])
        if cutoff_rank_col in data.columns and len(data) > 0
        else None
    )

    cutoff_score_col = f"{column}_if_cutoff_score_samples"
    cutoff_score_samples = None
    if cutoff_score_col in data.columns and len(data) > 0:
        raw_cutoff = data[cutoff_score_col].iloc[0]
        if not pd.isna(raw_cutoff):
            cutoff_score_samples = float(raw_cutoff)

    contamination_col = f"{column}_if_contamination"
    contamination = (
        _to_builtin_scalar(data[contamination_col].iloc[0])
        if contamination_col in data.columns and len(data) > 0
        else None
    )

    skew_col = f"{column}_distribution_skewness"
    distribution_skewness = (
        float(data[skew_col].iloc[0])
        if skew_col in data.columns and len(data) > 0
        else None
    )

    return {
        "flagged": flagged,
        "total": total,
        "pct": pct,
        "score_min": round(float(backbone_scores.min()), 4) if len(backbone_scores) else 0,
        "score_max": round(float(backbone_scores.max()), 4) if len(backbone_scores) else 0,
        "score_mean": round(float(backbone_scores.mean()), 4) if len(backbone_scores) else 0,
        "selected_transform": selected_transform,
        "threshold": round(threshold, 6) if threshold is not None else None,
        "selection_fraction": selection_fraction,
        "selection_count": selection_count,
        "cutoff_rank": cutoff_rank,
        "cutoff_score_samples": round(cutoff_score_samples, 6) if cutoff_score_samples is not None else None,
        "contamination": contamination,
        "distribution_skewness": round(distribution_skewness, 6)
        if distribution_skewness is not None
        else None,
    }
