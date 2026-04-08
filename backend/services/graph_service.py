"""
backend/services/graph_service.py
Handles loading graphs from CSV, computing stats, and converting
to the JSON format that D3.js expects on the frontend.
"""
import random
from typing import Optional
import networkx as nx
import pandas as pd
from pathlib import Path


def load_graph(csv_path: Path) -> nx.Graph:
    """
    Load a graph from an edge-list CSV.
    Required columns: source, target
    Optional column:  weight (defaults to 1.0 if missing)
    """
    df = pd.read_csv(csv_path)

    # Normalise column names to lowercase
    df.columns = [c.strip().lower() for c in df.columns]

    if "source" not in df.columns or "target" not in df.columns:
        raise ValueError(
            f"CSV must have 'source' and 'target' columns. "
            f"Found: {list(df.columns)}"
        )

    if "weight" not in df.columns:
        df["weight"] = 1.0

    # Keep only numeric weights; fill any NaN with 1
    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(1.0)

        # For research experiments we only want the structural edge list.
    # Drop any previously computed score columns that may exist in raw files.
    df = df[["source", "target", "weight"]].copy()

    G = nx.from_pandas_edgelist(df, edge_attr=True)
    return G


def stable_edge_key(source: object, target: object) -> str:
    left, right = sorted((str(source), str(target)))
    return f"{left}|{right}"


def graph_stats(G: nx.Graph) -> dict:
    """Return a dict of basic statistics about the graph."""
    n   = len(G.nodes())
    m   = len(G.edges())
    max_edges = n * (n - 1) / 2 if n > 1 else 1
    density   = round(m / max_edges, 6) if max_edges > 0 else 0

    degrees    = [d for _, d in G.degree()]
    avg_degree = round(sum(degrees) / len(degrees), 2) if degrees else 0

    weights    = [d.get("weight", 1) for _, _, d in G.edges(data=True)]
    is_weighted = len(set(weights)) > 1

    components = nx.number_connected_components(G)

    return {
        "nodes":       n,
        "edges":       m,
        "density":     density,
        "avg_degree":  avg_degree,
        "components":  components,
        "is_weighted": is_weighted,
        "max_degree":  int(max(degrees)) if degrees else 0,
    }


def graph_to_json(G: nx.Graph, max_edges: Optional[int] = 1500) -> dict:
    """
    Convert a networkx Graph to the D3 node-link JSON format.
    If the graph is very large, sample edges to keep the browser fast.
    """
    edges = list(G.edges(data=True))
    sampled = False

    if max_edges is not None and len(edges) > max_edges:
        edges   = random.sample(edges, max_edges)
        sampled = True

    # Collect only the nodes that appear in sampled edges
    visible_nodes = set()
    for u, v, _ in edges:
        visible_nodes.add(u)
        visible_nodes.add(v)

    # Compute degree for node sizing
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


def graph_from_edgelist(df: pd.DataFrame) -> nx.Graph:
    """Build a networkx Graph from a scored edge-list DataFrame."""
    G = nx.from_pandas_edgelist(df, source="source", target="target", edge_attr=True)
    return G
