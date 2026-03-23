"""
backend/services/anomaly_service.py
Handles running anomaly labeling and saving labeled CSVs.
"""
import pandas as pd
from pathlib import Path

from backend.core.anomaly import (
    label_anomalies,
    label_anomalies_with_percentile,
    anomaly_summary,
)
from backend.core.methods import METHOD_REGISTRY
from backend.config import SESSIONS_DIR
from backend.services.score_service import load_scores


def run_anomaly_labeling(session_id: str, method_id: str) -> dict:
    """
    Run automatic (IsolationForest) anomaly labeling for one method.
    Saves labeled CSV and returns a summary.
    """
    config     = METHOD_REGISTRY[method_id]
    score_col  = config["score_column"]

    # Load the previously computed scores
    data = load_scores(session_id, method_id)

    # Label using IsolationForest
    data = label_anomalies(data, score_col)

    # Save to labeled folder
    labeled_dir = SESSIONS_DIR / session_id / "labeled"
    labeled_dir.mkdir(parents=True, exist_ok=True)
    out_path = labeled_dir / f"{method_id}.csv"
    data.to_csv(out_path, index=False)

    return anomaly_summary(data, score_col)


def run_manual_labeling(session_id: str, method_id: str, percentile: float) -> dict:
    """
    Re-label using a manual percentile threshold (drives the slider in Step 4).
    Updates the existing labeled CSV in place.
    """
    config    = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]

    labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"

    # Start from labeled data if it exists, else from scores
    if labeled_path.exists():
        data = pd.read_csv(labeled_path)
    else:
        data = load_scores(session_id, method_id)

    # Ensure normalised column exists
    if f"{score_col}_normalized" not in data.columns:
        from backend.core.anomaly import label_anomalies as _la
        data = _la(data, score_col)

    data = label_anomalies_with_percentile(data, score_col, percentile)
    data.to_csv(labeled_path, index=False)

    return anomaly_summary(data, score_col)


def load_labeled(session_id: str, method_id: str) -> pd.DataFrame:
    """Load labeled edge data for one method."""
    path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Labeled data not found for method '{method_id}'")
    return pd.read_csv(path)


def get_score_distribution(session_id: str, method_id: str) -> list:
    """
    Return a histogram-friendly list of { bin, count, is_backbone } dicts
    for rendering the score distribution chart in Step 4.
    """
    config    = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    norm_col  = f"{score_col}_normalized"
    anom_col  = f"{score_col}_anomaly"

    labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
    if not labeled_path.exists():
        return []

    data = pd.read_csv(labeled_path)
    if norm_col not in data.columns:
        return []

    import numpy as np
    bins    = np.linspace(0, 1, 21)    # 20 equal bins
    labels_ = bins[:-1]
    result  = []

    for i in range(len(bins) - 1):
        lo, hi   = bins[i], bins[i + 1]
        mask     = (data[norm_col] >= lo) & (data[norm_col] < hi)
        total    = int(mask.sum())
        backbone = int(((data[anom_col] == -1) & mask).sum()) if anom_col in data.columns else 0
        result.append({
            "bin":      round(float(labels_[i]), 2),
            "total":    total,
            "backbone": backbone,
            "normal":   total - backbone,
        })

    return result
