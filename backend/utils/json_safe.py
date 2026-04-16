"""Helpers for returning strict JSON from FastAPI.

Starlette/FastAPI uses strict JSON by default (allow_nan=False). Pandas and
NumPy often contain NaN/inf values, especially in compatibility columns such as
`*_if_threshold`. This helper converts every non-finite value to None and NumPy
scalars/arrays to plain Python objects before returning API responses.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
import math

import numpy as np
import pandas as pd


def _is_missing(value: Any) -> bool:
    try:
        # pd.isna(np.ndarray) returns an array, so avoid sequence-like values.
        if isinstance(value, (list, tuple, dict, set)):
            return False
        result = pd.isna(value)
        if isinstance(result, (bool, np.bool_)):
            return bool(result)
    except Exception:
        pass
    return False


def sanitize_for_json(value: Any) -> Any:
    """Recursively convert value into strict-JSON-safe Python data.

    - NaN, +inf, -inf, pandas NA/NaT -> None
    - NumPy scalars -> Python scalars
    - NumPy arrays / pandas Series -> lists
    - pandas DataFrame -> list[dict]
    """
    if isinstance(value, pd.DataFrame):
        return sanitize_for_json(value.replace([np.inf, -np.inf], np.nan).to_dict(orient="records"))

    if isinstance(value, pd.Series):
        return sanitize_for_json(value.replace([np.inf, -np.inf], np.nan).tolist())

    if isinstance(value, np.ndarray):
        return sanitize_for_json(value.tolist())

    if isinstance(value, np.generic):
        return sanitize_for_json(value.item())

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    if isinstance(value, int):
        return value

    if _is_missing(value):
        return None

    if isinstance(value, Mapping):
        return {str(k): sanitize_for_json(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [sanitize_for_json(v) for v in value]

    return value
