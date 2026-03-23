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
    """
    scores_dir = SESSIONS_DIR / session_id / "scores"
    scores_dir.mkdir(parents=True, exist_ok=True)

    G = load_graph(dataset_path)
    summary = {}
    loop = asyncio.get_event_loop()

    for method_id in method_ids:
        config = METHOD_REGISTRY.get(method_id)
        if not config:
            continue

        await ws_manager.broadcast(session_id, {
            "type":     "progress",
            "method":   method_id,
            "stage":    "computing",
            "progress": 0,
            "message":  f"Starting {config['label']} …",
        })

        # progress_pct is a mutable container so the sync thread can write to it
        progress_pct = [0]

        def make_progress_cb(mid: str, pct_holder: list):
            """
            Returns a plain sync callback the algorithm calls with a 0-100 int.
            It schedules a WebSocket broadcast safely from a background thread
            using call_soon_threadsafe.
            """
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
                # Schedule the coroutine on the event loop from the worker thread
                asyncio.run_coroutine_threadsafe(_send(), loop)
            return cb

        progress_cb = make_progress_cb(method_id, progress_pct)

        # Run the CPU-bound algorithm in a thread pool so the event loop stays free
        G_copy = G.copy()
        fn     = config["function"]
        kwargs = {**config.get("kwargs", {}), "progress_cb": progress_cb}

        G_scored = await loop.run_in_executor(None, partial(fn, G_copy, **kwargs))

        # Save the scored edge list as CSV
        out_path = scores_dir / f"{method_id}.csv"
        nx.to_pandas_edgelist(G_scored).to_csv(out_path, index=False)

        score_col = config["score_column"]
        summary[method_id] = {
            "edges_scored": len(G_scored.edges()),
            "score_column": score_col,
            "output_path":  str(out_path),
        }

        await ws_manager.broadcast(session_id, {
            "type":     "progress",
            "method":   method_id,
            "stage":    "computing",
            "progress": 100,
            "message":  f"{config['label']} complete ✓",
        })

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
