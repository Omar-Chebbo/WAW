"""
backend/services/backbone_service.py
Extracts the backbone subgraph for each method using the
appropriate threshold strategy.
"""
import json
import networkx as nx
import pandas as pd
from pathlib import Path

from backend.core.methods import METHOD_REGISTRY
from backend.config import SESSIONS_DIR
from backend.services.graph_service import graph_to_json, graph_stats
from backend.services.score_service import load_scores


def extract_backbone(session_id: str, method_id: str) -> dict:
    """
    Extract the backbone for one method and save the result.
    Returns a summary with node count, edge count, and retention %.
    """
    config    = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    threshold = config["default_threshold"]
    direction = config["threshold_direction"]
    requires  = config["requires_anomaly"]

    # Load the right DataFrame depending on whether anomaly labeling was used
    if requires:
        # Load labeled data
        labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
        if not labeled_path.exists():
            raise FileNotFoundError(
                f"Anomaly labeling not done yet for method '{method_id}'. "
                f"Please complete Step 4 first."
            )
        df       = pd.read_csv(labeled_path)
        anom_col = f"{score_col}_anomaly"
        backbone_df = df[df[anom_col] == -1]
    else:
        df = load_scores(session_id, method_id)
        if direction == "gte":
            backbone_df = df[df[score_col] >= threshold]
        elif direction == "lte":
            backbone_df = df[df[score_col] <= threshold]
        else:
            backbone_df = df

    # Build the backbone NetworkX graph
    backbone = nx.from_pandas_edgelist(backbone_df, source="source", target="target", edge_attr=True)

    # Also load the full original graph for comparison
    original = nx.from_pandas_edgelist(df, source="source", target="target", edge_attr=True)

    # Save backbone as JSON (D3 format)
    backbone_dir = SESSIONS_DIR / session_id / "backbones"
    backbone_dir.mkdir(parents=True, exist_ok=True)

    out_path = backbone_dir / f"{method_id}.json"
    with open(out_path, "w") as f:
        json.dump(graph_to_json(backbone), f)

    orig_edges = len(original.edges())
    back_edges = len(backbone.edges())

    return {
        "method_id":       method_id,
        "nodes":           len(backbone.nodes()),
        "edges":           back_edges,
        "original_edges":  orig_edges,
        "edge_retention":  round(back_edges / orig_edges * 100, 1) if orig_edges > 0 else 0,
        "node_retention":  round(
            len(backbone.nodes()) / len(original.nodes()) * 100, 1
        ) if len(original.nodes()) > 0 else 0,
    }


def load_backbone_json(session_id: str, method_id: str) -> dict:
    """Return the saved D3-format backbone JSON."""
    path = SESSIONS_DIR / session_id / "backbones" / f"{method_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Backbone not extracted yet for method '{method_id}'")
    with open(path) as f:
        return json.load(f)
