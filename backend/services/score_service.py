"""
backend/services/score_service.py
Orchestrates score computation for one or many methods.
Streams progress events via the WebSocket manager so the
frontend progress bar stays up to date in real time.

Now includes dataset-level score caching so PA / LP / PA+LP
can be reused across wizard runs and experiment labs.
"""
from __future__ import annotations

import asyncio
from functools import partial
from pathlib import Path

import networkx as nx
import pandas as pd

from backend.config import SESSIONS_DIR
from backend.core.methods import METHOD_REGISTRY
from backend.services.graph_service import load_graph
from backend.services.score_cache_service import (
    get_cache_status,
    get_session_score_path,
    has_valid_cached_score,
    load_cached_score,
    merge_pa_lp_scores,
    save_cached_score,
    save_session_score,
    session_score_matches_dataset,
)


async def compute_scores(
    session_id: str,
    dataset_path: Path,
    method_ids: list[str],
    ws_manager,
    score_strategy: str = "auto",
) -> dict:
    """
    Make all requested score files ready for the session.

    score_strategy values:
    - auto/reuse: reuse saved dataset-level scores when possible,
      otherwise compute the missing ones once and save them.
    - recompute: compute fresh scores and overwrite the saved cache.
    """
    if score_strategy == "reuse":
        score_strategy = "auto"
    if score_strategy not in {"auto", "recompute"}:
        raise ValueError("score_strategy must be 'auto', 'reuse', or 'recompute'.")

    scores_dir = SESSIONS_DIR / session_id / "scores"
    scores_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, dict] = {}
    loop = asyncio.get_event_loop()
    request_results: dict[str, pd.DataFrame] = {}
    request_graph = None

    async def send_progress(method_id: str, progress: int, message: str, stage: str = "computing"):
        await ws_manager.broadcast(
            session_id,
            {
                "type": "progress",
                "method": method_id,
                "stage": stage,
                "progress": progress,
                "message": message,
            },
        )

    async def send_method_ready(method_id: str, message: str):
        await send_progress(method_id, 100, message, stage="ready")

    def compute_regular_method_sync(
        method_id: str,
        progress_scale: tuple[int, int] = (0, 100),
        progress_method_id: str | None = None,
        progress_label: str | None = None,
    ) -> pd.DataFrame:
        nonlocal request_graph
        config = METHOD_REGISTRY[method_id]
        if request_graph is None:
            request_graph = load_graph(dataset_path)

        target_method_id = progress_method_id or method_id
        target_label = progress_label or config["label"]
        start_pct, end_pct = progress_scale
        span = max(1, end_pct - start_pct)

        def progress_cb(raw_pct: int):
            scaled = start_pct + int((max(0, min(100, raw_pct)) / 100.0) * span)
            async def _send():
                await ws_manager.broadcast(
                    session_id,
                    {
                        "type": "progress",
                        "method": target_method_id,
                        "stage": "computing",
                        "progress": scaled,
                        "message": f"Computing {target_label} … {scaled}%",
                    },
                )
            asyncio.run_coroutine_threadsafe(_send(), loop)

        kwargs = {**config.get("kwargs", {}), "progress_cb": progress_cb}
        scored_graph = config["function"](request_graph.copy(), **kwargs)
        return nx.to_pandas_edgelist(scored_graph)

    async def compute_and_store_regular_method(method_id: str) -> tuple[pd.DataFrame, str]:
        config = METHOD_REGISTRY[method_id]
        await send_progress(method_id, 0, f"Starting {config['label']} …")
        df = await loop.run_in_executor(None, partial(compute_regular_method_sync, method_id))
        save_cached_score(dataset_path, method_id, df, origin="computed")
        save_session_score(session_id, method_id, df, dataset_path=dataset_path)
        request_results[method_id] = df
        await send_method_ready(method_id, f"{config['label']} computed and saved ✓")
        return df, "recomputed"

    async def ensure_regular_method_ready(method_id: str) -> tuple[pd.DataFrame, str]:
        config = METHOD_REGISTRY[method_id]
        session_path = get_session_score_path(session_id, method_id)

        if score_strategy != "recompute" and session_score_matches_dataset(session_id, method_id, dataset_path):
            df = pd.read_csv(session_path)
            request_results[method_id] = df
            await send_method_ready(method_id, f"Reused current session {config['label']} score ✓")
            return df, "session"

        if score_strategy != "recompute" and has_valid_cached_score(dataset_path, method_id):
            df = load_cached_score(dataset_path, method_id)
            save_session_score(session_id, method_id, df, dataset_path=dataset_path)
            request_results[method_id] = df
            await send_method_ready(method_id, f"Reused saved {config['label']} score from cache ✓")
            return df, "cache"

        return await compute_and_store_regular_method(method_id)

    async def ensure_combined_method_ready() -> tuple[pd.DataFrame, str]:
        method_id = "pa_lp"
        config = METHOD_REGISTRY[method_id]
        session_path = get_session_score_path(session_id, method_id)

        if score_strategy != "recompute" and session_score_matches_dataset(session_id, method_id, dataset_path):
            df = pd.read_csv(session_path)
            request_results[method_id] = df
            await send_method_ready(method_id, "Reused current session PA+LP score ✓")
            return df, "session"

        if score_strategy != "recompute" and has_valid_cached_score(dataset_path, method_id):
            df = load_cached_score(dataset_path, method_id)
            save_session_score(session_id, method_id, df, dataset_path=dataset_path)
            request_results[method_id] = df
            await send_method_ready(method_id, "Reused saved PA+LP score from cache ✓")
            return df, "cache"

        await send_progress(method_id, 0, f"Starting {config['label']} …")

        # Reuse fresh request-level results when possible.
        if score_strategy != "recompute":
            pa_df = request_results.get("pa")
            lp_df = request_results.get("lp")
        else:
            pa_df = request_results.get("pa") if "pa" in method_ids else None
            lp_df = request_results.get("lp") if "lp" in method_ids else None

        if pa_df is None:
            if score_strategy != "recompute" and has_valid_cached_score(dataset_path, "pa"):
                pa_df = load_cached_score(dataset_path, "pa")
                await send_progress(method_id, 35, "Loaded saved PA scores for PA+LP …")
            else:
                def compute_pa_for_combined():
                    return compute_regular_method_sync("pa", progress_scale=(0, 50), progress_method_id="pa_lp", progress_label="PA + LP (PA phase)")
                pa_df = await loop.run_in_executor(None, compute_pa_for_combined)
                save_cached_score(dataset_path, "pa", pa_df, origin="computed")
                await send_progress(method_id, 50, "PA scores ready for PA+LP …")
                request_results.setdefault("pa", pa_df)
                if "pa" in method_ids:
                    save_session_score(session_id, "pa", pa_df, dataset_path=dataset_path)
                    await send_method_ready("pa", "PA+IF computed and saved ✓")

        if lp_df is None:
            if score_strategy != "recompute" and has_valid_cached_score(dataset_path, "lp"):
                lp_df = load_cached_score(dataset_path, "lp")
                await send_progress(method_id, 75, "Loaded saved LP scores for PA+LP …")
            else:
                def compute_lp_for_combined():
                    return compute_regular_method_sync("lp", progress_scale=(50, 100), progress_method_id="pa_lp", progress_label="PA + LP (LP phase)")
                lp_df = await loop.run_in_executor(None, compute_lp_for_combined)
                save_cached_score(dataset_path, "lp", lp_df, origin="computed")
                request_results.setdefault("lp", lp_df)
                if "lp" in method_ids:
                    save_session_score(session_id, "lp", lp_df, dataset_path=dataset_path)
                    await send_method_ready("lp", "LP+IF computed and saved ✓")

        combined = merge_pa_lp_scores(pa_df, lp_df)
        save_cached_score(dataset_path, method_id, combined, origin="derived")
        save_session_score(session_id, method_id, combined, dataset_path=dataset_path)
        request_results[method_id] = combined
        await send_method_ready(method_id, f"{config['label']} ready ✓")
        return combined, "derived"

    for method_id in method_ids:
        config = METHOD_REGISTRY.get(method_id)
        if not config:
            continue

        if method_id == "pa_lp":
            df, source_kind = await ensure_combined_method_ready()
            summary[method_id] = {
                "edges_scored": len(df),
                "score_column": "pa_lp",
                "feature_columns": ["preferential_attachment_1", "local_path_index_1"],
                "source_kind": source_kind,
                "output_path": str(get_session_score_path(session_id, method_id)),
            }
            continue

        # ── Direct Thresholding methods: derive scores from base method ──
        derives_from = config.get("derives_from")
        if derives_from and config.get("selection_method") in ("direct_high", "direct_low"):
            base_session_path = get_session_score_path(session_id, derives_from)

            # Ensure the base method scores are available
            if derives_from not in request_results:
                # Try to reuse from session or cache
                if score_strategy != "recompute" and session_score_matches_dataset(session_id, derives_from, dataset_path):
                    base_df = pd.read_csv(base_session_path)
                elif score_strategy != "recompute" and has_valid_cached_score(dataset_path, derives_from):
                    base_df = load_cached_score(dataset_path, derives_from)
                    save_session_score(session_id, derives_from, base_df, dataset_path=dataset_path)
                else:
                    # Compute the base method first
                    base_df, _ = await ensure_regular_method_ready(derives_from)
                    request_results[derives_from] = base_df
            else:
                base_df = request_results[derives_from]

            # Copy the base method's scores for this derived method
            save_session_score(session_id, method_id, base_df, dataset_path=dataset_path)
            request_results[method_id] = base_df
            base_config = METHOD_REGISTRY[derives_from]
            await send_method_ready(
                method_id,
                f"{config['label']} derived from {base_config['label']} scores ✓",
            )
            summary[method_id] = {
                "edges_scored": len(base_df),
                "score_column": config["score_column"],
                "source_kind": "derived",
                "derives_from": derives_from,
                "output_path": str(get_session_score_path(session_id, method_id)),
            }
            continue

        df, source_kind = await ensure_regular_method_ready(method_id)
        summary[method_id] = {
            "edges_scored": len(df),
            "score_column": config["score_column"],
            "source_kind": source_kind,
            "output_path": str(get_session_score_path(session_id, method_id)),
        }

    cache_status = get_cache_status(dataset_path, method_ids)
    await ws_manager.broadcast(
        session_id,
        {
            "type": "complete",
            "message": "All requested score files are ready.",
            "cache_status": cache_status,
        },
    )

    return summary



def load_scores(session_id: str, method_id: str) -> pd.DataFrame:
    """Load a previously computed score CSV for one method from the session."""
    path = SESSIONS_DIR / session_id / "scores" / f"{method_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Scores not found for method '{method_id}'")
    return pd.read_csv(path)
