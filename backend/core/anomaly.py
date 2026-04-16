"""
backend/core/anomaly.py
Pure-function anomaly labeling — no file I/O here.
The service layer handles reading/writing files.
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


@dataclass
class AnomalyLabelResult:
    """
    Dual result for anomaly labeling.

    - `data` keeps the full labeled DataFrame used by the current app UI/workflow.
    - `backbone` keeps the new graph-native Backbone object introduced by the refactor.

    The class intentionally forwards common DataFrame operations so older code that still
    expects a DataFrame continues to work while the new Backbone representation is preserved.
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


def _build_backbone_object(data: pd.DataFrame, column: str) -> Backbone | None:
    """
    Build the graph-native Backbone object that the refactor introduced.

    The labeled DataFrame remains the source of truth for the current UI, while the returned
    Backbone instance lets the project keep the newer abstraction the doctor wanted.
    """
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

    # Best-effort bridge for future code that may want direct access to the labeled table.
    try:
        setattr(backbone, "labeled_data", data.copy())
    except Exception:
        pass

    return backbone


def label_anomalies(
    data: pd.DataFrame,
    column: str,
    transform_id: str | None = None,
    contamination: float | str = "auto",
) -> AnomalyLabelResult:
    """
    Label edges as backbone (anomaly=-1) or normal (1) using Isolation Forest.

    Added columns:
      {column}_transformed           -> transformed feature sent to the model
      {column}_normalized            -> min-max version kept for display / manual thresholding
      {column}_anomaly_score         -> kept for backward compatibility (decision_function)
      {column}_if_score_samples      -> raw Isolation Forest score scale
      {column}_if_decision_function  -> shifted score, threshold = 0
      {column}_if_threshold          -> model threshold on score_samples (clf.offset_)
      {column}_if_contamination      -> contamination used in this run
      {column}_if_rank               -> abnormality rank (1 = most abnormal)
      {column}_anomaly               -> +1 normal, -1 backbone
      {column}_preprocessing         -> transform name used for this run

    Returns:
      AnomalyLabelResult(data=<labeled dataframe>, backbone=<Backbone instance>)
    """

    scores = data[column].to_numpy(dtype=float)
    num_edges = len(data)

    decision = choose_preprocessing(scores)
    selected_transform = transform_id or decision["selected_transform"]

    transformed = apply_transformation(scores, selected_transform)
    normalized = MinMaxScaler().fit_transform(transformed.reshape(-1, 1)).reshape(-1)

    X = transformed.reshape(-1, 1)

    clf = IsolationForest(
        contamination=contamination,
        max_samples=num_edges,
        random_state=42,
    )
    clf.fit(X)

    labels = clf.predict(X)
    score_samples = clf.score_samples(X).reshape(-1)
    decision_scores = clf.decision_function(X).reshape(-1)
    threshold = float(clf.offset_)

    # Lower score_samples = more abnormal in scikit-learn Isolation Forest
    rank_order = np.argsort(score_samples)
    rank = np.empty_like(rank_order)
    rank[rank_order] = np.arange(1, len(score_samples) + 1)

    labeled = data.copy()
    labeled[f"{column}_transformed"] = transformed
    labeled[f"{column}_normalized"] = normalized

    # old column kept so the rest of the project does not break
    labeled[f"{column}_anomaly_score"] = decision_scores

    # new explicit IF columns
    labeled[f"{column}_if_score_samples"] = score_samples
    labeled[f"{column}_if_decision_function"] = decision_scores
    labeled[f"{column}_if_threshold"] = threshold
    labeled[f"{column}_if_contamination"] = contamination
    labeled[f"{column}_if_rank"] = rank

    labeled[f"{column}_anomaly"] = labels
    labeled[f"{column}_preprocessing"] = selected_transform
    labeled[f"{column}_shape_class"] = decision["shape_class"]
    labeled[f"{column}_distribution_skewness"] = decision["decision_features"]["skewness"]
    labeled[f"{column}_zero_ratio"] = decision["decision_features"]["zero_ratio"]

    backbone = _build_backbone_object(labeled, column)
    return AnomalyLabelResult(data=labeled, backbone=backbone)


def label_anomalies_with_percentile(
    data: DataLike, column: str, percentile: float
) -> pd.DataFrame:
    """
    Label edges using a manual percentile threshold instead of IsolationForest.
    Edges with normalized score >= percentile threshold are flagged as backbone (-1).
    """
    data = extract_result_dataframe(data)
    norm_col = f"{column}_normalized"

    if norm_col not in data.columns:
        data = extract_result_dataframe(label_anomalies(data, column))

    cutoff = np.percentile(data[norm_col].values, percentile)

    data = data.copy()
    data[f"{column}_anomaly"] = np.where(data[norm_col] >= cutoff, -1, 1)
    return data


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

    threshold_col = f"{column}_if_threshold"
    threshold = (
        float(data[threshold_col].iloc[0])
        if threshold_col in data.columns and len(data) > 0
        else None
    )

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
        "contamination": contamination,
        "distribution_skewness": round(distribution_skewness, 6)
        if distribution_skewness is not None
        else None,
    }
