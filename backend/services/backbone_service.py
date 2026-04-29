"""
backend/services/backbone_service.py
Extracts the backbone subgraph and prepares the full Step-6 visualization
comparison data.
"""
import json
from pathlib import Path

import networkx as nx
import pandas as pd

from backend.core.methods import METHOD_REGISTRY
from backend.config import SESSIONS_DIR
from backend.services.graph_service import (
    compute_stable_layout,
    graph_to_json,
    graph_to_json_with_positions,
    stable_edge_key,
)
from backend.services.score_service import load_scores


def extract_backbone(session_id: str, method_id: str) -> dict:
    """
    Extract the backbone for one method and save the result.
    Returns a summary with node count, edge count, and retention %.
    """
    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    threshold = config["default_threshold"]
    direction = config["threshold_direction"]
    requires = config["requires_anomaly"]

    if requires:
        labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
        if not labeled_path.exists():
            raise FileNotFoundError(
                f"Anomaly labeling not done yet for method '{method_id}'. Please complete Step 4 first."
            )
        df = pd.read_csv(labeled_path)
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

    backbone = nx.from_pandas_edgelist(backbone_df, source="source", target="target", edge_attr=True)
    original = nx.from_pandas_edgelist(df, source="source", target="target", edge_attr=True)

    backbone_dir = SESSIONS_DIR / session_id / "backbones"
    backbone_dir.mkdir(parents=True, exist_ok=True)

    out_path = backbone_dir / f"{method_id}.json"
    with open(out_path, "w") as f:
        json.dump(graph_to_json(backbone, max_edges=None), f)

    orig_edges = len(original.edges())
    back_edges = len(backbone.edges())

    return {
        "method_id": method_id,
        "nodes": len(backbone.nodes()),
        "edges": back_edges,
        "original_edges": orig_edges,
        "edge_retention": round(back_edges / orig_edges * 100, 1) if orig_edges > 0 else 0,
        "node_retention": round(len(backbone.nodes()) / len(original.nodes()) * 100, 1) if len(original.nodes()) > 0 else 0,
    }


def load_backbone_json(session_id: str, method_id: str) -> dict:
    """Return the saved D3-format backbone JSON."""
    path = SESSIONS_DIR / session_id / "backbones" / f"{method_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Backbone not extracted yet for method '{method_id}'")
    with open(path) as f:
        return json.load(f)


def _edge_key_from_row(row: pd.Series) -> str:
    return stable_edge_key(row["source"], row["target"])


def _load_labeled_or_scores(session_id: str, method_id: str) -> pd.DataFrame:
    labeled_path = SESSIONS_DIR / session_id / "labeled" / f"{method_id}.csv"
    if labeled_path.exists():
        return pd.read_csv(labeled_path)
    return load_scores(session_id, method_id)



def _canonical_edge_rows(df: pd.DataFrame) -> list[tuple[str, str, float]]:
    """Return source/target/weight rows in deterministic edge order."""
    rows: list[tuple[str, str, float]] = []
    for _, row in df.iterrows():
        source = str(row["source"])
        target = str(row["target"])
        left, right = sorted((source, target))
        weight = row.get("weight", 1.0)
        try:
            weight = float(weight) if pd.notna(weight) else 1.0
        except Exception:
            weight = 1.0
        rows.append((left, right, weight))
    rows.sort(key=lambda item: (item[0], item[1]))
    return rows


def _build_canonical_graph_from_df(df: pd.DataFrame) -> nx.Graph:
    """
    Build the original graph deterministically. PA and LP must use the exact
    same graph/layout, otherwise the same network appears rotated differently.
    """
    G = nx.Graph()
    edges = _canonical_edge_rows(df)
    nodes = sorted({u for u, _, _ in edges} | {v for _, v, _ in edges})
    G.add_nodes_from(nodes)
    for u, v, weight in edges:
        G.add_edge(u, v, weight=weight, edge_key=stable_edge_key(u, v))
    return G


def _graph_layout_signature(df: pd.DataFrame) -> dict:
    """Small signature used to avoid reusing a layout from another dataset."""
    rows = _canonical_edge_rows(df)
    edge_keys = [stable_edge_key(u, v) for u, v, _ in rows]
    nodes = sorted({u for u, _, _ in rows} | {v for _, v, _ in rows})
    return {
        "nodes": len(nodes),
        "edges": len(edge_keys),
        "first_nodes": nodes[:20],
        "last_nodes": nodes[-20:],
        "first_edges": edge_keys[:20],
        "last_edges": edge_keys[-20:],
    }


def _get_or_create_shared_visual_layout(session_id: str, df: pd.DataFrame) -> dict:
    """
    Create one shared Step-6 layout per session/dataset and reuse it for PA, LP,
    score-extreme view, IF-backbone view, and exports.
    """
    layout_dir = SESSIONS_DIR / session_id / "visualization"
    layout_dir.mkdir(parents=True, exist_ok=True)
    layout_path = layout_dir / "shared_layout.json"

    signature = _graph_layout_signature(df)
    if layout_path.exists():
        try:
            with open(layout_path, "r") as f:
                saved = json.load(f)
            if saved.get("signature") == signature:
                return {
                    str(node_id): (float(pos[0]), float(pos[1]))
                    for node_id, pos in saved.get("positions", {}).items()
                }
        except Exception:
            pass

    canonical_graph = _build_canonical_graph_from_df(df)
    positions = compute_stable_layout(canonical_graph)

    serializable_positions = {
        str(node_id): [float(pos[0]), float(pos[1])]
        for node_id, pos in positions.items()
    }
    with open(layout_path, "w") as f:
        json.dump({"signature": signature, "positions": serializable_positions}, f)

    return {
        node_id: (coords[0], coords[1])
        for node_id, coords in serializable_positions.items()
    }


def build_visual_comparison_json(session_id: str, method_id: str, low_pct: float = 0.20, high_pct: float = 0.20) -> dict:
    """
    Build the full, unsampled graph used in Step 6.

    Each edge carries:
    - score: PA/LP raw score for the active method
    - score_region: low / high / normal based on bottom/top percentage
    - is_if_backbone: true when Isolation Forest selected the edge

    Node positions are computed once from the full graph and reused by the
    score-extreme view and the IF-backbone view.
    """
    if method_id not in METHOD_REGISTRY:
        raise FileNotFoundError(f"Unknown method '{method_id}'")

    config = METHOD_REGISTRY[method_id]
    score_col = config["score_column"]
    df = _load_labeled_or_scores(session_id, method_id).copy()

    if score_col not in df.columns:
        raise FileNotFoundError(f"Score column '{score_col}' not found for method '{method_id}'")

    df["edge_key"] = df.apply(_edge_key_from_row, axis=1)
    df[score_col] = pd.to_numeric(df[score_col], errors="coerce").fillna(0.0)

    total_edges = len(df)
    low_count = max(1, int(round(total_edges * low_pct))) if total_edges else 0
    high_count = max(1, int(round(total_edges * high_pct))) if total_edges else 0

    sorted_low = df.sort_values(score_col, ascending=True, kind="mergesort")
    sorted_high = df.sort_values(score_col, ascending=False, kind="mergesort")
    low_edges = set(sorted_low.head(low_count)["edge_key"].astype(str))
    high_edges = set(sorted_high.head(high_count)["edge_key"].astype(str))

    anomaly_col = f"{score_col}_anomaly"
    if anomaly_col in df.columns:
        if_edges = set(df.loc[df[anomaly_col] == -1, "edge_key"].astype(str))
    else:
        # Fallback to saved backbone JSON if labels are not loaded.
        try:
            back = load_backbone_json(session_id, method_id)
            if_edges = set(str(link.get("edge_key")) for link in back.get("links", []) if link.get("edge_key"))
        except FileNotFoundError:
            if_edges = set()

    G = nx.Graph()
    for _, row in df.iterrows():
        source = str(row["source"])
        target = str(row["target"])
        key = str(row["edge_key"])
        if key in low_edges:
            score_region = "low"
        elif key in high_edges:
            score_region = "high"
        else:
            score_region = "normal"

        G.add_edge(
            source,
            target,
            weight=float(row.get("weight", 1.0) if pd.notna(row.get("weight", 1.0)) else 1.0),
            score=float(row[score_col]),
            score_region=score_region,
            is_low_score=key in low_edges,
            is_high_score=key in high_edges,
            is_if_backbone=key in if_edges,
            edge_key=key,
        )

    positions = _get_or_create_shared_visual_layout(session_id, df)
    graph = graph_to_json_with_positions(G, positions)

    return {
        "method_id": method_id,
        "score_column": score_col,
        "low_percent": low_pct,
        "high_percent": high_pct,
        "low_count": len(low_edges),
        "high_count": len(high_edges),
        "if_count": len(if_edges),
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "graph": graph,
    }
