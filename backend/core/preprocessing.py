"""
backend/core/preprocessing.py
Utilities for describing link-prediction score distributions,
selecting a preprocessing strategy, and applying transformations.

This module is research-oriented but is also used by the final
anomaly-labeling pipeline so preprocessing is chosen dynamically.
"""
from __future__ import annotations

from typing import Dict

import numpy as np
from scipy.stats import skew, kurtosis
from sklearn.preprocessing import MinMaxScaler, StandardScaler


TRANSFORM_DESCRIPTIONS: Dict[str, str] = {
    "raw": "Use raw scores directly. Best when the distribution is already reasonably well behaved.",
    "log": "Apply log1p(score) to compress large positive outliers and reduce right-skew.",
    "minmax": "Scale scores linearly to [0, 1]. Preserves ordering but removes absolute scale.",
    "zscore": "Center to mean 0 and variance 1. Useful when variance is large or negative values may appear.",
    "log_minmax": "First apply log1p, then min-max scaling. Good default for heavy-tailed non-negative scores.",
    "log_zscore": "First apply log1p, then z-score standardization. Useful when skew is high and spread still matters.",
}


def _safe_array(values) -> np.ndarray:
    arr = np.asarray(values, dtype=float).reshape(-1)
    if arr.size == 0:
        raise ValueError("Score array is empty.")
    arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
    return arr


def compute_distribution_stats(values, bins: int = 20) -> dict:
    """Return descriptive statistics and histogram data for a 1D score array."""
    arr = _safe_array(values)

    if arr.size == 1:
        skewness = 0.0
        kurt = 0.0
    else:
        skewness = float(skew(arr, bias=False, nan_policy="omit"))
        kurt = float(kurtosis(arr, fisher=True, bias=False, nan_policy="omit"))
        if np.isnan(skewness):
            skewness = 0.0
        if np.isnan(kurt):
            kurt = 0.0

    counts, edges = np.histogram(arr, bins=bins)
    histogram = []
    for i, count in enumerate(counts):
        left = float(edges[i])
        right = float(edges[i + 1])
        histogram.append({
            "bin_left": round(left, 6),
            "bin_right": round(right, 6),
            "bin_center": round((left + right) / 2, 6),
            "count": int(count),
        })

    unique_ratio = float(len(np.unique(arr)) / len(arr)) if len(arr) else 0.0
    zero_ratio = float(np.mean(arr == 0)) if len(arr) else 0.0

    return {
        "mean": round(float(np.mean(arr)), 6),
        "median": round(float(np.median(arr)), 6),
        "variance": round(float(np.var(arr)), 6),
        "std": round(float(np.std(arr)), 6),
        "min": round(float(np.min(arr)), 6),
        "max": round(float(np.max(arr)), 6),
        "skewness": round(skewness, 6),
        "kurtosis": round(kurt, 6),
        "zero_ratio": round(zero_ratio, 6),
        "unique_ratio": round(unique_ratio, 6),
        "histogram": histogram,
    }


def classify_distribution(values) -> dict:
    """
    Heuristic classification for runtime preprocessing decisions.

    Design philosophy:
    - keep rules simple and transparent;
    - prefer a robust default (log_minmax) for highly right-skewed positive scores;
    - fall back to minmax when the distribution is heavily zero-inflated;
    - keep z-score options available for future methods that may produce negative values.
    """
    arr = _safe_array(values)
    stats = compute_distribution_stats(arr)

    skewness = stats["skewness"]
    zero_ratio = stats["zero_ratio"]
    unique_ratio = stats["unique_ratio"]
    has_negative = bool(np.any(arr < 0))

    if has_negative and abs(skewness) <= 1.0:
        shape_class = "mixed_signed"
        recommended = "zscore"
        reason = (
            "Scores include negative values, so log-based transforms are unsafe. "
            "A z-score transformation is the safest generic choice."
        )
    elif zero_ratio >= 0.70 and unique_ratio <= 0.15:
        shape_class = "zero_inflated"
        recommended = "minmax"
        reason = (
            "The score distribution is strongly zero-inflated and low-resolution. "
            "log1p would keep the mass at zero and add little separation, so min-max scaling is simpler."
        )
    elif skewness >= 1.5:
        shape_class = "strong_right_skew"
        recommended = "log_minmax"
        reason = (
            "The distribution is heavily right-skewed. A log transform compresses the tail, "
            "then min-max scaling keeps the anomaly model input on a stable range."
        )
    elif skewness >= 0.75:
        shape_class = "moderate_right_skew"
        recommended = "log_minmax"
        reason = (
            "The distribution is moderately right-skewed. log1p + min-max is a robust default "
            "that usually improves numerical stability without changing score ordering too aggressively."
        )
    elif abs(skewness) <= 0.75:
        shape_class = "approximately_symmetric"
        recommended = "raw"
        reason = (
            "The distribution is close to symmetric, so extra preprocessing is not strictly necessary. "
            "Using raw scores keeps the final pipeline simpler."
        )
    else:
        shape_class = "other"
        recommended = "minmax"
        reason = (
            "No single strong shape pattern was detected. Min-max scaling is a simple fallback that keeps the pipeline stable."
        )

    return {
        **stats,
        "shape_class": shape_class,
        "recommended_transform": recommended,
        "auto_decision_reason": reason,
    }


def apply_transformation(values, transform_id: str) -> np.ndarray:
    """Apply one supported transformation and return a flat numpy array."""
    arr = _safe_array(values)

    if transform_id == "raw":
        out = arr
    elif transform_id == "log":
        if np.any(arr < 0):
            raise ValueError("Log transformation requires non-negative scores.")
        out = np.log1p(arr)
    elif transform_id == "minmax":
        out = MinMaxScaler().fit_transform(arr.reshape(-1, 1)).reshape(-1)
    elif transform_id == "zscore":
        out = StandardScaler().fit_transform(arr.reshape(-1, 1)).reshape(-1)
    elif transform_id == "log_minmax":
        if np.any(arr < 0):
            raise ValueError("Log transformation requires non-negative scores.")
        logged = np.log1p(arr)
        out = MinMaxScaler().fit_transform(logged.reshape(-1, 1)).reshape(-1)
    elif transform_id == "log_zscore":
        if np.any(arr < 0):
            raise ValueError("Log transformation requires non-negative scores.")
        logged = np.log1p(arr)
        out = StandardScaler().fit_transform(logged.reshape(-1, 1)).reshape(-1)
    else:
        raise ValueError(f"Unknown transformation: {transform_id}")

    return np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)


def choose_preprocessing(values) -> dict:
    """Convenience wrapper used by the final algorithmic pipeline."""
    info = classify_distribution(values)
    selected = info["recommended_transform"]
    return {
        "feasible": True,
        "selected_transform": selected,
        "reason": info["auto_decision_reason"],
        "shape_class": info["shape_class"],
        "decision_features": {
            "skewness": info["skewness"],
            "zero_ratio": info["zero_ratio"],
            "unique_ratio": info["unique_ratio"],
        },
    }