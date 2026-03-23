"""
backend/core/evaluation.py
All structural metric functions live here.
Each function takes (original_graph, backbone_graph) and returns
(backbone_value, relative_deviation_from_original).
METRIC_REGISTRY makes them discoverable — add a new metric by
adding a function + one registry entry.
"""
import networkx as nx
import numpy as np
from scipy.stats import entropy as scipy_entropy, ks_2samp


# ── Helper ─────────────────────────────────────────────────────────

def _rel_diff(original: float, backbone: float) -> float:
    """Relative deviation: (backbone - original) / original. Returns 0 if original == 0."""
    if original == 0:
        return 0.0
    return round((backbone - original) / original, 4)


# ── Individual metric functions ────────────────────────────────────

def node_fraction(original: nx.Graph, backbone: nx.Graph):
    orig = len(original.nodes())
    back = len(backbone.nodes())
    fraction = round(back / orig, 4) if orig > 0 else 0.0
    return fraction, _rel_diff(orig, back)


def edge_fraction(original: nx.Graph, backbone: nx.Graph):
    orig = len(original.edges())
    back = len(backbone.edges())
    fraction = round(back / orig, 4) if orig > 0 else 0.0
    return fraction, _rel_diff(orig, back)


def reachability(original: nx.Graph, backbone: nx.Graph):
    """Fraction of node pairs that can reach each other (normalised)."""
    G = backbone
    if len(G) == 0:
        return 0.0, -1.0
    r = sum(c * (c - 1) for c in (len(comp) for comp in nx.connected_components(G)))
    denom = len(G) * (len(G) - 1)
    back = r / denom if denom > 0 else 0.0
    return round(back, 4), _rel_diff(1.0, back)   # original reachability = 1 (connected)


def number_components(original: nx.Graph, backbone: nx.Graph):
    orig = nx.number_connected_components(original)
    back = nx.number_connected_components(backbone)
    return back, _rel_diff(orig, back)


def transitivity(original: nx.Graph, backbone: nx.Graph):
    orig = nx.transitivity(original)
    back = nx.transitivity(backbone)
    return round(back, 4), _rel_diff(orig, back)


def average_clustering(original: nx.Graph, backbone: nx.Graph):
    orig = nx.average_clustering(original)
    back = nx.average_clustering(backbone)
    return round(back, 4), _rel_diff(orig, back)


def degree_entropy(original: nx.Graph, backbone: nx.Graph):
    orig_degrees = [d for _, d in original.degree()]
    back_degrees = [d for _, d in backbone.degree()]
    orig = scipy_entropy(orig_degrees, base=2) if orig_degrees else 0
    back = scipy_entropy(back_degrees, base=2) if back_degrees else 0
    return round(back, 4), _rel_diff(orig, back)


def weight_entropy(original: nx.Graph, backbone: nx.Graph):
    orig_w = [d.get("weight", 1) for _, _, d in original.edges(data=True)]
    back_w = [d.get("weight", 1) for _, _, d in backbone.edges(data=True)]
    orig = scipy_entropy(orig_w, base=2) if orig_w else 0
    back = scipy_entropy(back_w, base=2) if back_w else 0
    return round(back, 4), _rel_diff(orig, back)


def average_path_length(original: nx.Graph, backbone: nx.Graph):
    """Average shortest path length of the largest connected component."""
    def _apl(G):
        if len(G) == 0:
            return 0.0
        largest = max(nx.connected_components(G), key=len)
        sub = G.subgraph(largest)
        if len(sub) < 2:
            return 0.0
        try:
            return nx.average_shortest_path_length(sub)
        except Exception:
            return 0.0

    orig = _apl(original)
    back = _apl(backbone)
    return round(back, 4), _rel_diff(orig, back)


# ── Metric registry ────────────────────────────────────────────────

METRIC_REGISTRY = {
    "edge_fraction":      {"label": "Edge Percentage",             "function": edge_fraction},
    "node_fraction":      {"label": "Node Percentage",             "function": node_fraction},
    "reachability":       {"label": "Reachability",                "function": reachability},
    "num_components":     {"label": "Number of Components",        "function": number_components},
    "transitivity":       {"label": "Transitivity Deviation",      "function": transitivity},
    "avg_clustering":     {"label": "Avg Clustering Deviation",    "function": average_clustering},
    "degree_entropy":     {"label": "Degree Entropy",              "function": degree_entropy},
    "weight_entropy":     {"label": "Weight Entropy",              "function": weight_entropy},
    "avg_path_length":    {"label": "Avg Path Length",             "function": average_path_length},
}


def run_all_metrics(original: nx.Graph, backbone: nx.Graph, metric_ids: list) -> dict:
    """
    Run a selection of metrics and return results as a plain dict.
    Each key maps to { 'value': float, 'deviation': float, 'label': str }.
    """
    results = {}
    for mid in metric_ids:
        entry = METRIC_REGISTRY.get(mid)
        if not entry:
            continue
        try:
            value, deviation = entry["function"](original, backbone)
        except Exception as e:
            value, deviation = 0.0, 0.0
        results[mid] = {
            "label":     entry["label"],
            "value":     value,
            "deviation": deviation,
        }
    return results

def compute_distributions(original: nx.Graph, backbone: nx.Graph) -> dict:
    """
    Compute degree and weight CCDF distributions for original vs backbone,
    plus the Kolmogorov-Smirnov statistic for each — matching Figures 4 & 5
    of the WAW2025 paper.
    Returns sorted value lists so the frontend can plot CCDF directly.
    """
    orig_degrees = sorted([d for _, d in original.degree()])
    back_degrees = sorted([d for _, d in backbone.degree()])
    orig_weights = sorted([d.get("weight", 1) for _, _, d in original.edges(data=True)])
    back_weights = sorted([d.get("weight", 1) for _, _, d in backbone.edges(data=True)])

    ks_degree = float(ks_2samp(orig_degrees, back_degrees).statistic) if back_degrees else 1.0
    ks_weight = float(ks_2samp(orig_weights, back_weights).statistic) if back_weights else 1.0

    return {
        "degree": {
            "original": orig_degrees,
            "backbone": back_degrees,
            "ks": round(ks_degree, 3),
        },
        "weight": {
            "original": orig_weights,
            "backbone": back_weights,
            "ks": round(ks_weight, 3),
        },
    }