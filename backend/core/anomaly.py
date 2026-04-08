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


def label_anomalies(
    data: pd.DataFrame,
    column: str,
    transform_id: str | None = None,
    contamination: float | str = "auto",
) -> pd.DataFrame:
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
    """
    scores = data[column].to_numpy(dtype=float)

    decision = choose_preprocessing(scores)
    selected_transform = transform_id or decision["selected_transform"]

    transformed = apply_transformation(scores, selected_transform)
    normalized = MinMaxScaler().fit_transform(transformed.reshape(-1, 1)).reshape(-1)

    X = transformed.reshape(-1, 1)

    clf = IsolationForest(contamination=contamination, random_state=42)
    clf.fit(X)

    labels = clf.predict(X)
    score_samples = clf.score_samples(X).reshape(-1)
    decision_scores = clf.decision_function(X).reshape(-1)
    threshold = float(clf.offset_)

    # Lower score_samples = more abnormal in scikit-learn Isolation Forest
    rank_order = np.argsort(score_samples)
    rank = np.empty_like(rank_order)
    rank[rank_order] = np.arange(1, len(score_samples) + 1)

    data = data.copy()
    data[f"{column}_transformed"] = transformed
    data[f"{column}_normalized"] = normalized

    # old column kept so the rest of the project does not break
    data[f"{column}_anomaly_score"] = decision_scores

    # new explicit IF columns
    data[f"{column}_if_score_samples"] = score_samples
    data[f"{column}_if_decision_function"] = decision_scores
    data[f"{column}_if_threshold"] = threshold
    data[f"{column}_if_contamination"] = contamination
    data[f"{column}_if_rank"] = rank

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
        data[contamination_col].iloc[0]
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
        "distribution_skewness": round(distribution_skewness, 6) if distribution_skewness is not None else None,
    }