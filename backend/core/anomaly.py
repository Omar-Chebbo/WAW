"""
backend/core/anomaly.py
Pure-function anomaly labeling — no file I/O here.
The service layer handles reading/writing files.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import MinMaxScaler

from backend.core.preprocessing import apply_transformation, choose_preprocessing


def label_anomalies(data: pd.DataFrame, column: str, transform_id: str | None = None) -> pd.DataFrame:
    """
    Label edges as backbone (anomaly=-1) or normal (1) using IsolationForest.

    Dynamic preprocessing policy:
    - if transform_id is provided, use it explicitly;
    - otherwise, inspect the score distribution and select a transform automatically.

    Added columns:
      {column}_transformed       -> transformed feature sent to the model
      {column}_normalized        -> min-max version used by the existing UI slider
      {column}_anomaly_score     -> IsolationForest decision_function output
      {column}_anomaly           -> +1 normal, -1 backbone
      {column}_preprocessing     -> transform name used for this run
    """
    scores = data[column].to_numpy(dtype=float)

    decision = choose_preprocessing(scores)
    selected_transform = transform_id or decision["selected_transform"]

    transformed = apply_transformation(scores, selected_transform)

    # Keep this min-max column because Step 4 slider and histogram already depend on it
    normalized = MinMaxScaler().fit_transform(transformed.reshape(-1, 1)).reshape(-1)

    clf = IsolationForest(contamination="auto", random_state=42)
    labels = clf.fit_predict(transformed.reshape(-1, 1))
    anomaly_scores = clf.decision_function(transformed.reshape(-1, 1))

    data = data.copy()
    data[f"{column}_transformed"] = transformed
    data[f"{column}_normalized"] = normalized
    data[f"{column}_anomaly_score"] = anomaly_scores
    data[f"{column}_anomaly"] = labels
    data[f"{column}_preprocessing"] = selected_transform
    data[f"{column}_shape_class"] = decision["shape_class"]
    data[f"{column}_distribution_skewness"] = decision["decision_features"]["skewness"]
    data[f"{column}_zero_ratio"] = decision["decision_features"]["zero_ratio"]

    return data


def label_anomalies_with_percentile(
    data: pd.DataFrame, column: str, percentile: float
) -> pd.DataFrame:
    """
    Label edges using a manual percentile threshold instead of IsolationForest.
    Edges with normalized score >= percentile threshold are flagged as backbone (-1).
    """
    norm_col = f"{column}_normalized"

    if norm_col not in data.columns:
        data = label_anomalies(data, column)

    cutoff = np.percentile(data[norm_col].values, percentile)

    data = data.copy()
    data[f"{column}_anomaly"] = np.where(data[norm_col] >= cutoff, -1, 1)
    return data


def anomaly_summary(data: pd.DataFrame, column: str) -> dict:
    anomaly_col = f"{column}_anomaly"
    if anomaly_col not in data.columns:
        return {"flagged": 0, "total": len(data), "pct": 0.0}

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

    return {
        "flagged": flagged,
        "total": total,
        "pct": pct,
        "score_min": round(float(backbone_scores.min()), 4) if len(backbone_scores) else 0,
        "score_max": round(float(backbone_scores.max()), 4) if len(backbone_scores) else 0,
        "score_mean": round(float(backbone_scores.mean()), 4) if len(backbone_scores) else 0,
        "selected_transform": selected_transform,
    }