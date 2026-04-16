"""
backend/services/score_service.py
Orchestrates score computation for one or many methods.
Streams progress events via the WebSocket manager so the
frontend progress bar stays up to date in real time.

Key design decisions:
- Algorithms run in a thread pool (run_in_executor) so they don't
  block the async event loop.
- Progress callbacks store percentages in a shared dict; the main
  async loop polls and broadcasts them between methods.
- We avoid passing the event loop into threads (unsafe); instead we
  call loop.call_soon_threadsafe to schedule WebSocket sends.
"""
import asyncio
import networkx as nx
import pandas as pd
from pathlib import Path
from functools import partial

from backend.core.methods import METHOD_REGISTRY
from backend.services.graph_service import load_graph
from backend.config import SESSIONS_DIR



async def compute_scores(
    session_id: str,
    dataset_path: Path,
    method_ids: list,
    ws_manager,
) -> dict:
    """
    Compute backbone scores for every requested method.
    Saves one CSV per method under data/sessions/{session_id}/scores/.
    Returns a summary dict { method_id: { edges_scored, score_column } }.

    PA+LP is supported as a wizard method by computing PA and LP scores in one
    combined CSV. Its anomaly labeling later uses the two feature columns
    together and writes pa_lp_* anomaly-ranking columns.
    """
    scores_dir = SESSIONS_DIR / session_id / "scores"
    scores_dir.mkdir(parents=True, exist_ok=True)

    G = load_graph(dataset_path)
    summary = {}
    loop = asyncio.get_event_loop()

    async def send_progress(method_id: str, progress: int, message: str, stage: str = "computing"):
        await ws_manager.broadcast(session_id, {
            "type":     "progress",
            "method":   method_id,
            "stage":    stage,
            "progress": progress,
            "message":  message,
        })

    for method_id in method_ids:
        config = METHOD_REGISTRY.get(method_id)
        if not config:
            continue

        await send_progress(method_id, 0, f"Starting {config['label']} …")

        progress_pct = [0]

        def make_progress_cb(mid: str, pct_holder: list):
            def cb(pct: int):
                pct_holder[0] = pct
                async def _send():
                    await ws_manager.broadcast(session_id, {
                        "type":     "progress",
                        "method":   mid,
                        "stage":    "computing",
                        "progress": pct,
                        "message":  f"Computing {METHOD_REGISTRY[mid]['label']} … {pct}%",
                    })
                asyncio.run_coroutine_threadsafe(_send(), loop)
            return cb

        # PA+LP is a combined score table, not a separate graph-score function.
        if method_id == "pa_lp":
            def combined_compute():
                from backend.core.methods import preferential_attachment, local_path_index
                pa_graph = preferential_attachment(G.copy(), alpha=1)
                lp_graph = local_path_index(G.copy(), alpha=1)
                pa_df = nx.to_pandas_edgelist(pa_graph)
                lp_df = nx.to_pandas_edgelist(lp_graph)

                merge_keys = ["source", "target"]
                if "weight" in pa_df.columns and "weight" in lp_df.columns:
                    merge_keys.append("weight")

                combined = pa_df[merge_keys + ["preferential_attachment_1"]].merge(
                    lp_df[merge_keys + ["local_path_index_1"]],
                    on=merge_keys,
                    how="inner",
                )
                return combined

            combined_df = await loop.run_in_executor(None, combined_compute)
            out_path = scores_dir / "pa_lp.csv"
            combined_df.to_csv(out_path, index=False)

            summary[method_id] = {
                "edges_scored": len(combined_df),
                "score_column": "pa_lp",
                "feature_columns": ["preferential_attachment_1", "local_path_index_1"],
                "output_path":  str(out_path),
            }

            await send_progress(method_id, 100, f"{config['label']} complete ✓")
            continue

        progress_cb = make_progress_cb(method_id, progress_pct)

        G_copy = G.copy()
        fn     = config["function"]
        kwargs = {**config.get("kwargs", {}), "progress_cb": progress_cb}

        if fn is None:
            continue

        G_scored = await loop.run_in_executor(None, partial(fn, G_copy, **kwargs))

        out_path = scores_dir / f"{method_id}.csv"
        nx.to_pandas_edgelist(G_scored).to_csv(out_path, index=False)

        score_col = config["score_column"]
        summary[method_id] = {
            "edges_scored": len(G_scored.edges()),
            "score_column": score_col,
            "output_path":  str(out_path),
        }

        await send_progress(method_id, 100, f"{config['label']} complete ✓")

    await ws_manager.broadcast(session_id, {
        "type":    "complete",
        "message": "All scores computed.",
    })

    return summary



def load_scores(session_id: str, method_id: str) -> pd.DataFrame:
    """Load a previously computed score CSV for one method."""
    path = SESSIONS_DIR / session_id / "scores" / f"{method_id}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Scores not found for method '{method_id}'")
    return pd.read_csv(path)
