"""
backend/services/anomaly_service.py
Handles running anomaly labeling and saving labeled CSVs.
"""
import pandas as pd

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
    Run automatic anomaly labeling for one method.
    The preprocessing step is now selected dynamically inside label_anomalies().
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]

    data = load_scores(session_id, method_id)
    data = label_anomalies(data, score_col)

    labeled_dir = SESSIONS_DIR / session_id / "labeled"
    labeled_dir.mkdir(parents=True, exist_ok=True)
    out_path = labeled_dir / f"{method_id}.csv"
    data.to_csv(out_path, index=False)

    return anomaly_summary(data, score_col)


def run_manual_labeling(session_id: str, method_id: str, percentile: float) -> dict:
    """
    Re-label using a manual percentile threshold.
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]

    labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"

    if labeled_path.exists():
        data = pd.read_csv(labeled_path)
    else:
        data = load_scores(session_id, method_id)

    if f"{score_col}_normalized" not in data.columns:
        data = label_anomalies(data, score_col)

    data = label_anomalies_with_percentile(data, score_col, percentile)
    data.to_csv(labeled_path, index=False)

    return anomaly_summary(data, score_col)


def load_labeled(session_id: str, method_id: str) -> pd.DataFrame:
    path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Labeled data not found for method '{method_id}'")
    return pd.read_csv(path)


def get_score_distribution(session_id: str, method_id: str) -> list:
    """
    Return a histogram-friendly list of {bin, total, backbone, normal}.
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    norm_col = f"{score_col}_normalized"
    anom_col = f"{score_col}_anomaly"

    labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
    if not labeled_path.exists():
        return []

    data = pd.read_csv(labeled_path)
    if norm_col not in data.columns:
        return []

    import numpy as np

    bins = np.linspace(0, 1, 21)
    result = []

    for i in range(len(bins) - 1):
        lo, hi = bins[i], bins[i + 1]

        if i == len(bins) - 2:
            mask = (data[norm_col] >= lo) & (data[norm_col] <= hi)
        else:
            mask = (data[norm_col] >= lo) & (data[norm_col] < hi)

        total = int(mask.sum())
        backbone = int(((data[anom_col] == -1) & mask).sum()) if anom_col in data.columns else 0

        result.append({
            "bin": round(float(lo), 2),
            "total": total,
            "backbone": backbone,
            "normal": total - backbone,
        })

    return result