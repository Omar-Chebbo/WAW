"""
backend/services/anomaly_service.py
Handles running anomaly labeling and saving labeled CSVs.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core.anomaly import (
    label_anomalies,
    label_anomalies_with_percentile,
    anomaly_summary,
)
from backend.core.preprocessing import TRANSFORM_DESCRIPTIONS
from backend.core.methods import METHOD_REGISTRY
from backend.config import SESSIONS_DIR
from backend.services.score_service import load_scores


def _stable_edge_key(source: object, target: object) -> str:
    left, right = sorted((str(source), str(target)))
    return f"{left}|{right}"


def normalize_preprocessing_mode(preprocessing_mode: str | None) -> str | None:
    """
    Map frontend values to backend transform ids.

    frontend:
      auto, none, log, minmax, zscore, log_minmax

    backend:
      raw, log, minmax, zscore, log_minmax, log_zscore
    """
    if preprocessing_mode is None:
        return None

    normalized = preprocessing_mode.strip().lower()

    if normalized == "auto":
        return None

    if normalized == "none":
        return "raw"

    allowed = set(TRANSFORM_DESCRIPTIONS.keys())
    if normalized not in allowed:
        raise ValueError(f"Unsupported preprocessing mode: {preprocessing_mode}")

    return normalized


def run_anomaly_labeling(
    session_id: str,
    method_id: str,
    preprocessing_mode: str | None = None,
    contamination: float | None = None,
) -> dict:
    """
    Run anomaly labeling for one method using either:
    - backend default contamination (auto)
    - manual contamination
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    transform_id = normalize_preprocessing_mode(preprocessing_mode)

    if contamination is not None:
        if not (0 < contamination <= 0.5):
            raise ValueError(
                "Isolation Forest manual contamination must be in the range (0, 0.5]."
            )

    data = load_scores(session_id, method_id)
    data = label_anomalies(
        data,
        score_col,
        transform_id=transform_id,
        contamination=contamination if contamination is not None else "auto",
    )

    labeled_dir = SESSIONS_DIR / session_id / "labeled"
    labeled_dir.mkdir(parents=True, exist_ok=True)
    out_path = labeled_dir / f"{method_id}.csv"
    data.to_csv(out_path, index=False)

    return anomaly_summary(data, score_col)


def run_manual_labeling(session_id: str, method_id: str, percentile: float) -> dict:
    """
    Re-label using a manual percentile threshold on normalized scores.
    This is kept for lab mode only.
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


def build_histogram(values, anomaly_mask=None, bins: int = 20):
    arr = np.asarray(values, dtype=float)
    if len(arr) == 0:
        return []

    counts, edges = np.histogram(arr, bins=bins)
    _ = counts

    result = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]

        if i == len(edges) - 2:
            mask = (arr >= lo) & (arr <= hi)
        else:
            mask = (arr >= lo) & (arr < hi)

        total = int(mask.sum())
        anomalies = int((mask & anomaly_mask).sum()) if anomaly_mask is not None else 0

        result.append(
            {
                "bin_left": float(lo),
                "bin_right": float(hi),
                "bin_center": float((lo + hi) / 2),
                "total": total,
                "anomalies": anomalies,
                "normal": total - anomalies,
            }
        )

    return result


def build_score_stats(values):
    arr = np.asarray(values, dtype=float)
    if len(arr) == 0:
        return {
            "min": 0.0,
            "max": 0.0,
            "mean": 0.0,
            "median": 0.0,
            "std": 0.0,
            "skewness": 0.0,
        }

    s = pd.Series(arr)
    return {
        "min": float(s.min()),
        "max": float(s.max()),
        "mean": float(s.mean()),
        "median": float(s.median()),
        "std": float(s.std(ddof=0)),
        "skewness": float(s.skew()) if len(arr) > 2 else 0.0,
    }


def build_labeled_rows_from_df(data: pd.DataFrame) -> list[dict]:
    rows = data.copy()
    if "source" in rows.columns and "target" in rows.columns:
        rows["edge_key"] = rows.apply(
            lambda row: _stable_edge_key(row["source"], row["target"]), axis=1
        )
    return rows.to_dict(orient="records")


def build_anomaly_inspector_from_df(data: pd.DataFrame, method_id: str) -> dict:
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]

    raw_col = score_col
    transformed_col = f"{score_col}_transformed"
    score_samples_col = f"{score_col}_if_score_samples"
    decision_col = f"{score_col}_if_decision_function"
    anomaly_col = f"{score_col}_anomaly"
    rank_col = f"{score_col}_if_rank"
    preprocessing_col = f"{score_col}_preprocessing"
    threshold_col = f"{score_col}_if_threshold"
    contamination_col = f"{score_col}_if_contamination"

    anomaly_mask = (
        (data[anomaly_col] == -1).values
        if anomaly_col in data.columns
        else np.zeros(len(data), dtype=bool)
    )

    ranked = (
        data.sort_values(rank_col)[
            [
                raw_col,
                transformed_col,
                score_samples_col,
                decision_col,
                anomaly_col,
                rank_col,
            ]
        ]
        .to_dict(orient="records")
    )

    scatter = data[
        [
            raw_col,
            transformed_col,
            score_samples_col,
            decision_col,
            anomaly_col,
        ]
    ].to_dict(orient="records")

    return {
        "method_id": method_id,
        "score_column": score_col,
        "selected_transform": str(data[preprocessing_col].iloc[0]) if preprocessing_col in data.columns else None,
        "threshold": float(data[threshold_col].iloc[0]) if threshold_col in data.columns else None,
        "contamination": data[contamination_col].iloc[0] if contamination_col in data.columns else None,
        "counts": anomaly_summary(data, score_col),
        "stats": {
            "raw": build_score_stats(data[raw_col].values),
            "transformed": build_score_stats(data[transformed_col].values),
            "score_samples": build_score_stats(data[score_samples_col].values),
            "decision_function": build_score_stats(data[decision_col].values),
        },
        "histograms": {
            "raw": build_histogram(data[raw_col].values, anomaly_mask, bins=20),
            "transformed": build_histogram(data[transformed_col].values, anomaly_mask, bins=20),
            "score_samples": build_histogram(data[score_samples_col].values, anomaly_mask, bins=20),
            "decision_function": build_histogram(data[decision_col].values, anomaly_mask, bins=20),
        },
        "ranked_points": ranked,
        "scatter_points": scatter,
    }


def get_score_distribution(session_id: str, method_id: str) -> list:
    """
    Kept for backward compatibility. Returns histogram on normalized scores.
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

        result.append(
            {
                "bin": round(float(lo), 2),
                "total": total,
                "backbone": backbone,
                "normal": total - backbone,
            }
        )

    return result


def get_anomaly_inspector(session_id: str, method_id: str) -> dict:
    data = load_labeled(session_id, method_id)
    return build_anomaly_inspector_from_df(data, method_id)
