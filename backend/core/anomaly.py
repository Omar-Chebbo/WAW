"""
backend/core/anomaly.py
Pure-function anomaly labeling — no file I/O here.
The service layer handles reading/writing files.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import MinMaxScaler


def label_anomalies(data: pd.DataFrame, column: str) -> pd.DataFrame:
    """
    Label edges as backbone (anomaly=-1) or normal (1) using IsolationForest.
    Three new columns are added:
      {column}_log_transformed  — log1p of the raw score
      {column}_normalized       — min-max scaled to [0, 1]
      {column}_anomaly          — +1 = normal edge, -1 = backbone edge
    """
    scores = data[column].values

    # Log-transform reduces the strong right-skew typical in network scores
    log_scores = np.log1p(scores)

    # Normalise to [0, 1] so IsolationForest isn't confused by scale
    scaler     = MinMaxScaler()
    norm       = scaler.fit_transform(log_scores.reshape(-1, 1))

    # IsolationForest with contamination='auto' decides the fraction itself
    clf        = IsolationForest(contamination="auto", random_state=42)
    labels     = clf.fit_predict(norm)

    data[f"{column}_log_transformed"] = log_scores
    data[f"{column}_normalized"]      = norm.flatten()
    data[f"{column}_anomaly"]         = labels
    return data


def label_anomalies_with_percentile(
    data: pd.DataFrame, column: str, percentile: float
) -> pd.DataFrame:
    """
    Label edges using a manual percentile threshold instead of IsolationForest.
    Edges with normalised score >= percentile/100 are flagged as backbone (-1).
    This powers the threshold slider in Step 4.

    Args:
        data:       DataFrame with a column called {column}_normalized
        column:     base column name (e.g. 'preferential_attachment_1')
        percentile: 0-100; edges in the top (100-percentile)% are backbone
    """
    norm_col = f"{column}_normalized"

    # Make sure the normalised column exists; recompute if not
    if norm_col not in data.columns:
        data = label_anomalies(data, column)

    cutoff = np.percentile(data[norm_col].values, percentile)
    data[f"{column}_anomaly"] = np.where(
        data[norm_col] >= cutoff, -1, 1
    )
    return data


def anomaly_summary(data: pd.DataFrame, column: str) -> dict:
    """
    Return statistics about the current anomaly labeling for one method.
    Used by the frontend to show '312 edges flagged (18%)'.
    """
    anomaly_col = f"{column}_anomaly"
    if anomaly_col not in data.columns:
        return {"flagged": 0, "total": len(data), "pct": 0.0}

    flagged = int((data[anomaly_col] == -1).sum())
    total   = len(data)
    pct     = round(flagged / total * 100, 1) if total > 0 else 0.0

    norm_col = f"{column}_normalized"
    backbone_scores = (
        data.loc[data[anomaly_col] == -1, norm_col].values
        if norm_col in data.columns
        else np.array([])
    )

    return {
        "flagged":    flagged,
        "total":      total,
        "pct":        pct,
        "score_min":  round(float(backbone_scores.min()), 4) if len(backbone_scores) else 0,
        "score_max":  round(float(backbone_scores.max()), 4) if len(backbone_scores) else 0,
        "score_mean": round(float(backbone_scores.mean()), 4) if len(backbone_scores) else 0,
    }
