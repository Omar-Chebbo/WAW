"""
backend/services/graph_service.py
Handles loading graphs from CSV, computing stats, converting graphs to JSON,
and building stable layouts for visualization/export views.
"""
import random
import math
from typing import Optional
from pathlib import Path

import networkx as nx
import pandas as pd


def load_graph(csv_path: Path) -> nx.Graph:
    """
    Load a graph from an edge-list CSV.
    Required columns: source, target
    Optional column: weight (defaults to 1.0 if missing)
    """
    df = pd.read_csv(csv_path)
    df.columns = [c.strip().lower() for c in df.columns]

    if "source" not in df.columns or "target" not in df.columns:
        raise ValueError(
            f"CSV must have 'source' and 'target' columns. Found: {list(df.columns)}"
        )

    if "weight" not in df.columns:
        df["weight"] = 1.0

    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(1.0)
    df = df[["source", "target", "weight"]].copy()
    return nx.from_pandas_edgelist(df, edge_attr=True)


def stable_edge_key(source: object, target: object) -> str:
    left, right = sorted((str(source), str(target)))
    return f"{left}|{right}"


def graph_stats(G: nx.Graph) -> dict:
    """Return a dict of basic statistics about the graph."""
    n = len(G.nodes())
    m = len(G.edges())
    max_edges = n * (n - 1) / 2 if n > 1 else 1
    density = round(m / max_edges, 6) if max_edges > 0 else 0

    degrees = [d for _, d in G.degree()]
    avg_degree = round(sum(degrees) / len(degrees), 2) if degrees else 0

    weights = [d.get("weight", 1) for _, _, d in G.edges(data=True)]
    is_weighted = len(set(weights)) > 1
    components = nx.number_connected_components(G)

    return {
        "nodes": n,
        "edges": m,
        "density": density,
        "avg_degree": avg_degree,
        "components": components,
        "is_weighted": is_weighted,
        "max_degree": int(max(degrees)) if degrees else 0,
    }


def graph_to_json(G: nx.Graph, max_edges: Optional[int] = 1500) -> dict:
    """
    Convert a networkx Graph to D3 node-link JSON.
    If max_edges is not None and the graph is larger, randomly sample edges.
    """
    edges = list(G.edges(data=True))
    sampled = False

    if max_edges is not None and len(edges) > max_edges:
        edges = random.sample(edges, max_edges)
        sampled = True

    visible_nodes = set()
    for u, v, _ in edges:
        visible_nodes.add(u)
        visible_nodes.add(v)

    degree = dict(G.degree())
    nodes = [
        {"id": str(n), "degree": degree.get(n, 0)}
        for n in (visible_nodes if sampled else G.nodes())
    ]

    links = [
        {
            "source": str(u),
            "target": str(v),
            "weight": float(d.get("weight", 1)),
            "edge_key": stable_edge_key(u, v),
        }
        for u, v, d in edges
    ]

    return {"nodes": nodes, "links": links, "sampled": sampled}


def graph_to_json_with_positions(G: nx.Graph, positions: dict | None = None) -> dict:
    """
    Convert a full NetworkX graph to D3 JSON without sampling and include
    optional fixed node positions. Step 6 uses this so all comparison views
    keep exactly the same coordinates.
    """
    degree = dict(G.degree())
    positions = positions or {}

    nodes = []
    for n in G.nodes():
        node = {"id": str(n), "degree": degree.get(n, 0)}
        pos = positions.get(n)
        if pos is None and str(n) in positions:
            pos = positions.get(str(n))
        if pos is not None:
            x, y = pos
            node["x"] = float(x)
            node["y"] = float(y)
        nodes.append(node)

    links = []
    for u, v, d in G.edges(data=True):
        row = {
            "source": str(u),
            "target": str(v),
            "weight": float(d.get("weight", 1)),
            "edge_key": stable_edge_key(u, v),
        }
        for key, value in d.items():
            if key in row:
                continue
            try:
                if pd.isna(value):
                    continue
            except Exception:
                pass
            if hasattr(value, "item"):
                value = value.item()
            row[key] = value
        links.append(row)

    return {"nodes": nodes, "links": links, "sampled": False, "fixed_layout": bool(positions)}


def _normalize_layout_positions(positions: dict) -> dict:
    """
    Normalize and orient a layout so Step 6 and exports use the available
    space well. This avoids very tall/line-like drawings with huge white space.
    """
    if not positions:
        return {}

    clean = {}
    for node, pos in positions.items():
        try:
            x, y = float(pos[0]), float(pos[1])
            if math.isfinite(x) and math.isfinite(y):
                clean[str(node)] = (x, y)
        except Exception:
            continue

    if not clean:
        return {}

    xs = [p[0] for p in clean.values()]
    ys = [p[1] for p in clean.values()]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    width = max(xmax - xmin, 1e-9)
    height = max(ymax - ymin, 1e-9)

    # A common failure on hub-heavy large networks is a long vertical strip.
    # Rotate it once so the figure uses a landscape canvas better.
    if height > width * 1.20:
        clean = {node: (y, -x) for node, (x, y) in clean.items()}
        xs = [p[0] for p in clean.values()]
        ys = [p[1] for p in clean.values()]
        xmin, xmax = min(xs), max(xs)
        ymin, ymax = min(ys), max(ys)
        width = max(xmax - xmin, 1e-9)
        height = max(ymax - ymin, 1e-9)

    cx = (xmin + xmax) / 2.0
    cy = (ymin + ymax) / 2.0
    scale = max(width, height, 1e-9)
    return {node: ((x - cx) / scale, (y - cy) / scale) for node, (x, y) in clean.items()}


def _deterministic_graph_copy(G: nx.Graph) -> nx.Graph:
    """Copy graph with deterministic node/edge order for stable layouts."""
    H = nx.Graph()
    try:
        components = sorted(nx.connected_components(G), key=lambda c: (-len(c), sorted(map(str, c))[0]))
        ordered_nodes = [node for comp in components for node in sorted(comp, key=str)]
    except Exception:
        ordered_nodes = sorted(G.nodes(), key=str)

    for node in ordered_nodes:
        H.add_node(str(node), **dict(G.nodes[node]))

    edges = []
    for u, v, data in G.edges(data=True):
        a, b = sorted((str(u), str(v)))
        edges.append((a, b, dict(data)))
    for u, v, data in sorted(edges, key=lambda e: (e[0], e[1])):
        H.add_edge(u, v, **data)
    return H


def _try_graphviz_sfdp_layout(G: nx.Graph) -> dict | None:
    """
    Try Graphviz SFDP, a multiscale force-directed layout for large generic
    networks. If Graphviz is not installed, return None and use fallback.
    """
    H = _deterministic_graph_copy(G)

    try:
        from networkx.drawing.nx_agraph import graphviz_layout
        pos = graphviz_layout(
            H,
            prog="sfdp",
            args="-Goverlap=prism -Gsep=+35 -GK=3.0 -Grepulsiveforce=2.8 -Gstart=42",
        )
        if pos:
            return _normalize_layout_positions(pos)
    except Exception:
        pass

    try:
        from networkx.drawing.nx_pydot import graphviz_layout
        pos = graphviz_layout(H, prog="sfdp")
        if pos:
            return _normalize_layout_positions(pos)
    except Exception:
        pass

    return None


def compute_stable_layout(G: nx.Graph) -> dict:
    """
    Compute one deterministic, reusable layout for Step 6 and exports.

    Large graphs first try Graphviz SFDP. This avoids the unreadable spectral
    layout problem where hub-heavy networks become a thin vertical/horizontal
    line. If SFDP is unavailable, use deterministic spring_layout fallback.
    """
    n = G.number_of_nodes()
    m = G.number_of_edges()
    if n == 0:
        return {}
    if n == 1:
        node = next(iter(G.nodes()))
        return {str(node): (0.0, 0.0)}

    H = _deterministic_graph_copy(G)
    large_graph = n > 700 or m > 3500

    if large_graph:
        sfdp_pos = _try_graphviz_sfdp_layout(H)
        if sfdp_pos:
            return sfdp_pos

    iterations = 400 if n <= 350 else 300 if n <= 1200 else 220
    k = max(0.04, 4.8 / math.sqrt(max(n, 2)))
    try:
        pos = nx.spring_layout(
            H,
            seed=42,
            k=k,
            iterations=iterations,
            weight=None,
            scale=1.0,
        )
        return _normalize_layout_positions(pos)
    except Exception:
        return _normalize_layout_positions(nx.circular_layout(H, scale=1.0))


def graph_from_edgelist(df: pd.DataFrame) -> nx.Graph:
    """Build a networkx Graph from a scored edge-list DataFrame."""
    return nx.from_pandas_edgelist(df, source="source", target="target", edge_attr=True)
