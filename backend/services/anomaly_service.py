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
    label_by_direct_threshold,
    anomaly_summary,
    extract_result_dataframe,
    extract_result_backbone,
    normalize_selection_fraction,
)
from backend.core.preprocessing import TRANSFORM_DESCRIPTIONS
from backend.core.methods import METHOD_REGISTRY
from backend.config import SESSIONS_DIR
from backend.services.score_service import load_scores
from backend.core.multi_feature_analysis import label_multifeature_edges


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
    Run anomaly labeling for one method.

    New logic:
    - PA / LP: fit Isolation Forest once, rank edges by score_samples ascending,
      then keep the top requested percentage.
    - PA+LP: same ranking rule, but the Isolation Forest input is [PA, LP].
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    transform_id = normalize_preprocessing_mode(preprocessing_mode) or "raw"
    selection_fraction = normalize_selection_fraction(contamination)

    data = load_scores(session_id, method_id)

    selection_method = config.get("selection_method", "if")

    if method_id == "pa_lp":
        # For PA+LP, preprocessing_mode is interpreted as feature scaling /
        # transformation mode over the two feature columns.
        scaling_mode = "none" if transform_id == "raw" else transform_id
        data = label_multifeature_edges(
            data,
            contamination=selection_fraction,
            scaling_mode=scaling_mode,
        )
    elif selection_method in ("direct_high", "direct_low"):
        # Direct thresholding: no Isolation Forest, sort by raw score
        result = label_by_direct_threshold(
            data,
            score_col,
            contamination=selection_fraction,
            direction=selection_method,
        )
        data = extract_result_dataframe(result)
    else:
        result = label_anomalies(
            data,
            score_col,
            transform_id=transform_id,
            contamination=selection_fraction,
        )
        data = extract_result_dataframe(result)

    labeled_dir = SESSIONS_DIR / session_id / "labeled"
    labeled_dir.mkdir(parents=True, exist_ok=True)
    out_path = labeled_dir / f"{method_id}.csv"
    data.to_csv(out_path, index=False)

    return anomaly_summary(data, score_col)


def run_manual_labeling(session_id: str, method_id: str, percentile: float) -> dict:
    """
    Re-label using a manual percentage cut on the Isolation Forest anomaly ranking.
    `percentile=25` means top 25% most anomalous edges.
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    fraction = float(percentile) / 100.0

    labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"

    if labeled_path.exists():
        data = pd.read_csv(labeled_path)
    else:
        data = load_scores(session_id, method_id)

    selection_method = config.get("selection_method", "if")

    if method_id == "pa_lp":
        if f"{score_col}_if_rank" not in data.columns:
            data = label_multifeature_edges(data, contamination=fraction, scaling_mode="none")
        else:
            from backend.core.anomaly import apply_top_fraction_selection
            data = apply_top_fraction_selection(data, score_col, fraction)
    elif selection_method in ("direct_high", "direct_low"):
        # Direct threshold: re-sort and re-select by percentage
        from backend.core.anomaly import apply_top_fraction_selection
        if f"{score_col}_if_rank" not in data.columns:
            result = label_by_direct_threshold(
                data, score_col, contamination=fraction, direction=selection_method,
            )
            data = extract_result_dataframe(result)
        else:
            data = apply_top_fraction_selection(data, score_col, fraction)
    else:
        if f"{score_col}_normalized" not in data.columns:
            data = extract_result_dataframe(label_anomalies(data, score_col, contamination=fraction))
        data = label_anomalies_with_percentile(data, score_col, percentile)

    data.to_csv(labeled_path, index=False)
    return anomaly_summary(data, score_col)


def load_labeled(session_id: str, method_id: str) -> pd.DataFrame:
    path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Labeled data not found for method '{method_id}'")
    return pd.read_csv(path)


def _has_finite(values) -> bool:
    """Return True if *values* contains at least one finite (non-NaN, non-inf) number."""
    arr = np.asarray(values, dtype=float)
    return len(arr) > 0 and bool(np.any(np.isfinite(arr)))


def _default_stats() -> dict:
    """Zeroed-out stats returned when a column is entirely NaN."""
    return {
        "min": 0.0, "max": 0.0, "mean": 0.0,
        "median": 0.0, "std": 0.0, "skewness": 0.0,
    }


def build_histogram(values, anomaly_mask=None, bins: int = 20):
    arr = np.asarray(values, dtype=float)
    if len(arr) == 0 or not _has_finite(arr):
        return []

    # Drop NaN/inf so the histogram bins are well-defined
    finite_mask = np.isfinite(arr)
    arr_clean = arr[finite_mask]
    if anomaly_mask is not None and len(anomaly_mask) == len(arr):
        anomaly_mask = anomaly_mask[finite_mask]

    counts, edges = np.histogram(arr_clean, bins=bins)
    _ = counts

    result = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]

        if i == len(edges) - 2:
            mask = (arr_clean >= lo) & (arr_clean <= hi)
        else:
            mask = (arr_clean >= lo) & (arr_clean < hi)

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
    cutoff_rank_col = f"{score_col}_if_cutoff_rank"
    cutoff_score_col = f"{score_col}_if_cutoff_score_samples"
    selection_count_col = f"{score_col}_if_selection_count"
    selection_fraction_col = f"{score_col}_if_selection_fraction"
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

    # For direct-threshold methods the IF columns (decision_function, score_samples)
    # may be entirely NaN because no Isolation Forest is fitted.
    has_decision = decision_col in data.columns and _has_finite(data[decision_col].values)
    has_score_samples = score_samples_col in data.columns and _has_finite(data[score_samples_col].values)

    return {
        "method_id": method_id,
        "score_column": score_col,
        "selected_transform": str(data[preprocessing_col].iloc[0]) if preprocessing_col in data.columns else None,
        "threshold": None,
        "cutoff_rank": (
            int(data[cutoff_rank_col].iloc[0])
            if cutoff_rank_col in data.columns and len(data) else None
        ),
        "cutoff_score_samples": (
            float(data[cutoff_score_col].iloc[0])
            if cutoff_score_col in data.columns and len(data) and not pd.isna(data[cutoff_score_col].iloc[0]) else None
        ),
        "selection_count": (
            int(data[selection_count_col].iloc[0])
            if selection_count_col in data.columns and len(data) else None
        ),
        "selection_fraction": (
            float(data[selection_fraction_col].iloc[0])
            if selection_fraction_col in data.columns and len(data) else None
        ),
        "contamination": (
            data[contamination_col].iloc[0].item()
            if contamination_col in data.columns and hasattr(data[contamination_col].iloc[0], 'item')
            else data[contamination_col].iloc[0] if contamination_col in data.columns else None
        ),
        "counts": anomaly_summary(data, score_col),
        "stats": {
            "raw": build_score_stats(data[raw_col].values) if _has_finite(data[raw_col].values) else _default_stats(),
            "transformed": build_score_stats(data[transformed_col].values) if _has_finite(data[transformed_col].values) else _default_stats(),
            "score_samples": build_score_stats(data[score_samples_col].values) if has_score_samples else _default_stats(),
            "decision_function": build_score_stats(data[decision_col].values) if has_decision else _default_stats(),
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