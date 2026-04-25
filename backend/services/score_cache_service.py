from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import networkx as nx
import pandas as pd

from backend.config import SCORE_CACHE_DIR, SCORE_CACHE_VERSION, SESSIONS_DIR
from backend.core.methods import METHOD_REGISTRY
from backend.services.graph_service import load_graph

PA_COLUMN = "preferential_attachment_1"
LP_COLUMN = "local_path_index_1"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_dataset_for_hash(dataset_path: Path) -> pd.DataFrame:
    df = pd.read_csv(dataset_path)
    df.columns = [str(c).strip().lower() for c in df.columns]

    if "source" not in df.columns or "target" not in df.columns:
        raise ValueError(
            f"CSV must have 'source' and 'target' columns. Found: {list(df.columns)}"
        )

    if "weight" not in df.columns:
        df["weight"] = 1.0

    df = df[["source", "target", "weight"]].copy()
    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(1.0).astype(float)

    normalized_pairs = df.apply(
        lambda row: sorted((str(row["source"]), str(row["target"]))),
        axis=1,
        result_type="expand",
    )
    normalized_pairs.columns = ["source", "target"]

    normalized = pd.concat([normalized_pairs, df[["weight"]]], axis=1)
    normalized = normalized.sort_values(["source", "target", "weight"], kind="mergesort").reset_index(drop=True)
    return normalized


def compute_dataset_fingerprint(dataset_path: Path) -> str:
    normalized = _normalize_dataset_for_hash(dataset_path)
    payload = normalized.to_csv(index=False, lineterminator="\n").encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def get_dataset_cache_dir(dataset_path: Path) -> Path:
    return SCORE_CACHE_DIR / compute_dataset_fingerprint(dataset_path)


def get_session_scores_dir(session_id: str) -> Path:
    path = SESSIONS_DIR / session_id / "scores"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_cache_file_path(dataset_path: Path, method_id: str) -> Path:
    return get_dataset_cache_dir(dataset_path) / f"{method_id}.csv"


def get_session_score_path(session_id: str, method_id: str) -> Path:
    return get_session_scores_dir(session_id) / f"{method_id}.csv"


def _session_meta_path(session_id: str) -> Path:
    return get_session_scores_dir(session_id) / "meta.json"


def _load_session_meta(session_id: str) -> dict[str, Any]:
    path = _session_meta_path(session_id)
    if not path.exists():
        return {"methods": {}}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {"methods": {}}


def _write_session_meta(session_id: str, meta: dict[str, Any]) -> None:
    _session_meta_path(session_id).write_text(json.dumps(meta, indent=2, sort_keys=True))


def session_score_matches_dataset(session_id: str, method_id: str, dataset_path: Path) -> bool:
    score_path = get_session_score_path(session_id, method_id)
    if not score_path.exists():
        return False
    meta = _load_session_meta(session_id)
    fingerprint = compute_dataset_fingerprint(dataset_path)
    return meta.get("methods", {}).get(method_id, {}).get("dataset_fingerprint") == fingerprint


def _meta_path(dataset_path: Path) -> Path:
    return get_dataset_cache_dir(dataset_path) / "meta.json"


def _load_meta(dataset_path: Path) -> dict[str, Any]:
    meta_path = _meta_path(dataset_path)
    if not meta_path.exists():
        return {
            "cache_version": SCORE_CACHE_VERSION,
            "dataset_fingerprint": compute_dataset_fingerprint(dataset_path),
            "dataset_name": dataset_path.name,
            "updated_at": None,
            "methods": {},
        }
    try:
        return json.loads(meta_path.read_text())
    except json.JSONDecodeError:
        return {
            "cache_version": SCORE_CACHE_VERSION,
            "dataset_fingerprint": compute_dataset_fingerprint(dataset_path),
            "dataset_name": dataset_path.name,
            "updated_at": None,
            "methods": {},
        }


def _write_meta(dataset_path: Path, meta: dict[str, Any]) -> None:
    cache_dir = get_dataset_cache_dir(dataset_path)
    cache_dir.mkdir(parents=True, exist_ok=True)
    meta["updated_at"] = _utc_now_iso()
    _meta_path(dataset_path).write_text(json.dumps(meta, indent=2, sort_keys=True))


def _is_meta_valid(dataset_path: Path, meta: dict[str, Any]) -> bool:
    return (
        meta.get("cache_version") == SCORE_CACHE_VERSION
        and meta.get("dataset_fingerprint") == compute_dataset_fingerprint(dataset_path)
    )


def merge_pa_lp_scores(pa_df: pd.DataFrame, lp_df: pd.DataFrame) -> pd.DataFrame:
    merge_keys = ["source", "target"]
    if "weight" in pa_df.columns and "weight" in lp_df.columns:
        merge_keys.append("weight")

    required_pa = merge_keys + [PA_COLUMN]
    required_lp = merge_keys + [LP_COLUMN]

    combined = pa_df[required_pa].merge(lp_df[required_lp], on=merge_keys, how="inner")
    if combined.empty:
        raise ValueError("Could not build a combined PA/LP score table for the selected dataset.")
    return combined


def get_cache_status(dataset_path: Path, method_ids: list[str]) -> dict[str, Any]:
    fingerprint = compute_dataset_fingerprint(dataset_path)
    cache_dir = get_dataset_cache_dir(dataset_path)
    meta = _load_meta(dataset_path)
    meta_valid = _is_meta_valid(dataset_path, meta)

    methods: dict[str, Any] = {}
    for method_id in method_ids:
        file_path = cache_dir / f"{method_id}.csv"
        method_meta = meta.get("methods", {}).get(method_id, {}) if meta_valid else {}
        direct_cached = meta_valid and file_path.exists() and bool(method_meta)

        can_build_from_components = False
        components_available: list[str] = []
        if method_id == "pa_lp":
            for component in ["pa", "lp"]:
                component_path = cache_dir / f"{component}.csv"
                component_meta = meta.get("methods", {}).get(component, {}) if meta_valid else {}
                if meta_valid and component_path.exists() and component_meta:
                    components_available.append(component)
            can_build_from_components = len(components_available) == 2

        status = "cached" if direct_cached else "missing"
        if method_id == "pa_lp" and not direct_cached and can_build_from_components:
            status = "derivable"

        methods[method_id] = {
            "exists": direct_cached or can_build_from_components,
            "status": status,
            "cached": direct_cached,
            "can_build_from_components": can_build_from_components,
            "components_available": components_available,
            "cached_at": method_meta.get("saved_at") if direct_cached else None,
            "rows": method_meta.get("rows") if direct_cached else None,
            "columns": method_meta.get("columns") if direct_cached else None,
            "path": str(file_path) if direct_cached else None,
        }

    return {
        "dataset_name": dataset_path.name,
        "dataset_fingerprint": fingerprint,
        "cache_version": SCORE_CACHE_VERSION,
        "methods": methods,
    }


def has_valid_cached_score(dataset_path: Path, method_id: str) -> bool:
    status = get_cache_status(dataset_path, [method_id])
    return bool(status["methods"][method_id]["cached"])


def load_cached_score(dataset_path: Path, method_id: str) -> pd.DataFrame:
    if not has_valid_cached_score(dataset_path, method_id):
        raise FileNotFoundError(f"Cached scores not found for method '{method_id}'")
    return pd.read_csv(get_cache_file_path(dataset_path, method_id))


def save_cached_score(dataset_path: Path, method_id: str, df: pd.DataFrame, origin: str = "computed") -> Path:
    cache_dir = get_dataset_cache_dir(dataset_path)
    cache_dir.mkdir(parents=True, exist_ok=True)
    out_path = cache_dir / f"{method_id}.csv"
    df.to_csv(out_path, index=False)

    meta = _load_meta(dataset_path)
    meta.update(
        {
            "cache_version": SCORE_CACHE_VERSION,
            "dataset_fingerprint": compute_dataset_fingerprint(dataset_path),
            "dataset_name": dataset_path.name,
        }
    )
    methods_meta = meta.setdefault("methods", {})
    methods_meta[method_id] = {
        "saved_at": _utc_now_iso(),
        "rows": int(len(df)),
        "columns": list(df.columns),
        "origin": origin,
        "path": str(out_path),
    }
    _write_meta(dataset_path, meta)
    return out_path


def copy_cached_score_to_session(session_id: str, dataset_path: Path, method_id: str) -> Path:
    src = get_cache_file_path(dataset_path, method_id)
    if not src.exists():
        raise FileNotFoundError(f"Cached score file not found for method '{method_id}'")
    dst = get_session_score_path(session_id, method_id)
    shutil.copy2(src, dst)
    return dst


def save_session_score(session_id: str, method_id: str, df: pd.DataFrame, dataset_path: Path | None = None) -> Path:
    out_path = get_session_score_path(session_id, method_id)
    df.to_csv(out_path, index=False)
    if dataset_path is not None:
        meta = _load_session_meta(session_id)
        methods_meta = meta.setdefault("methods", {})
        methods_meta[method_id] = {
            "dataset_fingerprint": compute_dataset_fingerprint(dataset_path),
            "dataset_name": dataset_path.name,
            "saved_at": _utc_now_iso(),
            "rows": int(len(df)),
            "columns": list(df.columns),
        }
        _write_session_meta(session_id, meta)
    return out_path


def compute_score_dataframe(dataset_path: Path, method_id: str, progress_cb=None) -> pd.DataFrame:
    if method_id == "pa_lp":
        pa_df = compute_score_dataframe(dataset_path, "pa", progress_cb=progress_cb)
        lp_df = compute_score_dataframe(dataset_path, "lp", progress_cb=progress_cb)
        return merge_pa_lp_scores(pa_df, lp_df)

    config = METHOD_REGISTRY.get(method_id)
    if not config or config.get("function") is None:
        raise ValueError(f"Method '{method_id}' does not support score computation.")

    graph = load_graph(dataset_path)
    kwargs = {**config.get("kwargs", {})}
    if progress_cb is not None:
        kwargs["progress_cb"] = progress_cb

    scored_graph = config["function"](graph.copy(), **kwargs)
    return nx.to_pandas_edgelist(scored_graph)


def get_or_compute_score_dataframe(dataset_path: Path, method_id: str, strategy: str = "auto") -> tuple[pd.DataFrame, str]:
    strategy = strategy or "auto"
    if strategy == "reuse":
        strategy = "auto"
    if strategy not in {"auto", "recompute"}:
        raise ValueError("strategy must be 'auto', 'reuse', or 'recompute'.")

    if strategy == "auto" and has_valid_cached_score(dataset_path, method_id):
        return load_cached_score(dataset_path, method_id), "cache"

    if method_id == "pa_lp":
        if strategy == "auto":
            pa_df, _ = get_or_compute_score_dataframe(dataset_path, "pa", strategy="auto")
            lp_df, _ = get_or_compute_score_dataframe(dataset_path, "lp", strategy="auto")
        else:
            pa_df, _ = get_or_compute_score_dataframe(dataset_path, "pa", strategy="recompute")
            lp_df, _ = get_or_compute_score_dataframe(dataset_path, "lp", strategy="recompute")
        combined = merge_pa_lp_scores(pa_df, lp_df)
        save_cached_score(dataset_path, "pa_lp", combined, origin="derived")
        return combined, "recomputed"

    df = compute_score_dataframe(dataset_path, method_id)
    save_cached_score(dataset_path, method_id, df, origin="computed")
    return df, "recomputed"


def materialize_score_for_session(
    session_id: str,
    dataset_path: Path,
    method_id: str,
    strategy: str = "auto",
) -> tuple[pd.DataFrame, str, Path]:
    strategy = strategy or "auto"
    if strategy == "reuse":
        strategy = "auto"
    if strategy not in {"auto", "recompute"}:
        raise ValueError("strategy must be 'auto', 'reuse', or 'recompute'.")

    session_path = get_session_score_path(session_id, method_id)
    if strategy != "recompute" and session_path.exists():
        return pd.read_csv(session_path), "session", session_path

    if strategy != "recompute" and has_valid_cached_score(dataset_path, method_id):
        out_path = copy_cached_score_to_session(session_id, dataset_path, method_id)
        return pd.read_csv(out_path), "cache", out_path

    if method_id == "pa_lp":
        pa_session_path = get_session_score_path(session_id, "pa")
        lp_session_path = get_session_score_path(session_id, "lp")

        if strategy != "recompute" and pa_session_path.exists() and lp_session_path.exists():
            pa_df = pd.read_csv(pa_session_path)
            lp_df = pd.read_csv(lp_session_path)
            combined = merge_pa_lp_scores(pa_df, lp_df)
            save_cached_score(dataset_path, "pa_lp", combined, origin="derived")
            out_path = save_session_score(session_id, "pa_lp", combined)
            return combined, "session_components", out_path

        if strategy != "recompute" and has_valid_cached_score(dataset_path, "pa") and has_valid_cached_score(dataset_path, "lp"):
            pa_df = load_cached_score(dataset_path, "pa")
            lp_df = load_cached_score(dataset_path, "lp")
            combined = merge_pa_lp_scores(pa_df, lp_df)
            save_cached_score(dataset_path, "pa_lp", combined, origin="derived")
            out_path = save_session_score(session_id, "pa_lp", combined)
            return combined, "cache_components", out_path

        pa_df, _, _ = materialize_score_for_session(session_id, dataset_path, "pa", strategy=strategy)
        lp_df, _, _ = materialize_score_for_session(session_id, dataset_path, "lp", strategy=strategy)
        combined = merge_pa_lp_scores(pa_df, lp_df)
        save_cached_score(dataset_path, "pa_lp", combined, origin="derived")
        out_path = save_session_score(session_id, "pa_lp", combined)
        return combined, "computed_components", out_path

    df = compute_score_dataframe(dataset_path, method_id)
    save_cached_score(dataset_path, method_id, df, origin="computed")
    out_path = save_session_score(session_id, method_id, df)
    return df, "recomputed", out_path
