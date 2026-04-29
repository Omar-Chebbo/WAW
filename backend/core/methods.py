"""
backbone/core/methods.py
All backbone algorithm implementations live here.
The METHOD_REGISTRY dict at the bottom makes every method
discoverable by the rest of the app — adding a new method
means adding one function + one registry entry, nothing else.
"""
import networkx as nx
import numpy as np
import math
from tqdm import tqdm


# ══════════════════════════════════════════════════════════════════
#  BACKBONE ALGORITHMS  (logic unchanged from original research code)
# ══════════════════════════════════════════════════════════════════

def high_salience_skeleton(graph, progress_cb=None):
    """
    High-Salience Skeleton (HSS).
    For every source node, compute shortest-path tree (using 1/weight
    as distance). An edge's salience = fraction of trees it appears in.
    Threshold: salience >= 0.8  →  backbone edge.
    """
    wes    = nx.get_edge_attributes(graph, 'weight')
    values = {pair: 1 / wes[pair] for pair in wes}
    nx.set_edge_attributes(graph, values, name='distance')
    nx.set_edge_attributes(graph, 0,      name='salience')

    nodes = list(graph.nodes())
    N     = len(nodes)

    for i, source in enumerate(nodes):
        tree  = nx.single_source_dijkstra(graph, source, weight='distance')[1]
        paths = list(tree.values())[1:]
        for path in paths:
            for j in range(len(path) - 1):
                graph[path[j]][path[j + 1]]['salience'] += 1
        if progress_cb and i % max(1, N // 20) == 0:
            progress_cb(int(i / N * 100))

    scores          = nx.get_edge_attributes(graph, 'salience')
    score_values    = {}
    backbone_edges  = {}
    for pair in scores:
        s = scores[pair] / N
        score_values[pair]   = s
        backbone_edges[pair] = s >= 0.8

    nx.set_edge_attributes(graph, score_values,   name='hss_score')
    nx.set_edge_attributes(graph, backbone_edges, name='hss_in_backbone')
    return graph


def disparity_filter(graph, progress_cb=None):
    """
    Disparity Filter (DF).
    Statistical test: is edge weight anomalously large relative to the
    node's total strength?  p-value < 0.05  →  backbone edge.
    """
    strength = graph.degree(weight='weight')
    edges    = list(graph.edges())
    total    = len(edges)

    for i, (u, v) in enumerate(edges):
        for node, neighbour in [(u, v), (v, u)]:
            k   = graph.degree[node]
            if k <= 1:
                continue
            w     = float(graph[node][neighbour]['weight'])
            p_ij  = w / strength[node]
            alpha = (1 - p_ij) ** (k - 1)
            key   = 'disparity_p_value'
            if key in graph[node][neighbour]:
                if alpha < graph[node][neighbour][key]:
                    graph[node][neighbour][key] = alpha
            else:
                graph[node][neighbour][key] = alpha
        if progress_cb and i % max(1, total // 20) == 0:
            progress_cb(int(i / total * 100))

    return graph


def preferential_attachment(graph, alpha=1, progress_cb=None):
    """
    Preferential Attachment (PA).
    Score = product of the weighted degrees of both endpoints.
    Backbone edges are identified by anomaly detection (IsolationForest),
    not a fixed threshold.
    """
    edges = list(graph.edges())
    total = len(edges)
    pbar  = tqdm(edges, desc="PA", leave=False)

    for i, edge in enumerate(pbar):
        node1, node2 = edge
        data = graph[node1][node2]
        graph.remove_edge(node1, node2)

        deg1 = sum(graph[node1][nb]['weight'] ** alpha for nb in graph.neighbors(node1))
        deg2 = sum(graph[node2][nb]['weight'] ** alpha for nb in graph.neighbors(node2))
        pa   = deg1 * deg2

        graph.add_edge(node1, node2, **data)
        graph.edges[edge][f'preferential_attachment_{alpha}'] = pa

        if progress_cb and i % max(1, total // 20) == 0:
            progress_cb(int(i / total * 100))

    return graph


def local_path_index(graph, alpha=1, progress_cb=None):
    """
    Local Path Index (LP).
    Counts 2-hop and 3-hop paths between endpoint pairs.
    score = |paths of length 2| + alpha * |paths of length 3|
    Backbone edges are identified by anomaly detection.
    """
    edges = list(graph.edges())
    total = len(edges)
    pbar  = tqdm(edges, desc="LP", leave=False)

    for i, edge in enumerate(pbar):
        node1, node2 = edge
        data = graph[node1][node2]
        graph.remove_edge(node1, node2)

        if len(list(nx.isolates(graph))) > 0:
            lp = 0
        else:
            try:
                p2 = list(nx.all_simple_paths(graph, node1, node2, cutoff=2))
                p3 = list(nx.all_simple_paths(graph, node1, node2, cutoff=3))
                lp = len(p2) + alpha * len(p3)
            except Exception:
                lp = 0

        graph.add_edge(node1, node2, **data)
        graph.edges[edge][f'local_path_index_{alpha}'] = lp

        if progress_cb and i % max(1, total // 20) == 0:
            progress_cb(int(i / total * 100))

    return graph


# ══════════════════════════════════════════════════════════════════
#  METHOD REGISTRY
#  Adding a new method = add a function above + one entry here.
# ══════════════════════════════════════════════════════════════════

METHOD_REGISTRY = {
    "hss": {
        "label":             "High Salience Skeleton",
        "short":             "HSS",
        "description":       "Keeps edges that appear in the shortest-path trees of most node pairs.",
        "function":          high_salience_skeleton,
        "kwargs":            {},
        "score_column":      "hss_score",
        "requires_anomaly":  False,
        "requires_preprocessing": False,
        "selection_method":  None,
        "derives_from":      None,
        "default_threshold": 0.8,
        "threshold_direction": "gte",   # keep where score >= threshold
        "color":             "#0F6E56",
    },
    "df": {
        "label":             "Disparity Filter",
        "short":             "DF",
        "description":       "Keeps edges whose weight is statistically significant relative to node strength.",
        "function":          disparity_filter,
        "kwargs":            {},
        "score_column":      "disparity_p_value",
        "requires_anomaly":  False,
        "requires_preprocessing": False,
        "selection_method":  None,
        "derives_from":      None,
        "default_threshold": 0.05,
        "threshold_direction": "lte",   # keep where score <= threshold (p-value)
        "color":             "#BA7517",
    },
    "pa": {
        "label":             "Preferential Attachment + IF",
        "short":             "PA+IF",
        "description":       "Scores edges by the product of endpoint degrees. High scores = backbone.",
        "function":          preferential_attachment,
        "kwargs":            {"alpha": 1},
        "score_column":      "preferential_attachment_1",
        "requires_anomaly":  True,
        "requires_preprocessing": True,
        "selection_method":  "if",
        "derives_from":      None,
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#3C3489",
    },
    "lp": {
        "label":             "Local Path Index + IF",
        "short":             "LP+IF",
        "description":       "Scores edges by counting 2-hop and 3-hop alternative paths between endpoints.",
        "function":          local_path_index,
        "kwargs":            {"alpha": 1},
        "score_column":      "local_path_index_1",
        "requires_anomaly":  True,
        "requires_preprocessing": True,
        "selection_method":  "if",
        "derives_from":      None,
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#993C1D",
    },
    "pa_lp": {
        "label":             "PA + LP (Multi-Feature)",
        "short":             "PA+LP",
        "description":       "Uses raw Preferential Attachment and Local Path scores together as a two-feature Isolation Forest input.",
        "function":          None,
        "kwargs":            {},
        "score_column":      "pa_lp",
        "requires_anomaly":  True,
        "requires_preprocessing": False,
        "selection_method":  "if",
        "derives_from":      None,
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#0F766E",
    },
    # ── Direct Thresholding Methods (no Isolation Forest) ───────────
    "high_pa": {
        "label":             "High PA (Direct Threshold)",
        "short":             "High PA",
        "description":       "Directly selects the top X% of edges with the highest PA scores as backbone. No Isolation Forest is used.",
        "function":          None,
        "kwargs":            {},
        "score_column":      "preferential_attachment_1",
        "requires_anomaly":  True,
        "requires_preprocessing": False,
        "selection_method":  "direct_high",
        "derives_from":      "pa",
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#4F46E5",
    },
    "low_pa": {
        "label":             "Low PA (Direct Threshold)",
        "short":             "Low PA",
        "description":       "Directly selects the bottom X% of edges with the lowest PA scores as backbone. No Isolation Forest is used.",
        "function":          None,
        "kwargs":            {},
        "score_column":      "preferential_attachment_1",
        "requires_anomaly":  True,
        "requires_preprocessing": False,
        "selection_method":  "direct_low",
        "derives_from":      "pa",
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#7C3AED",
    },
    "high_lp": {
        "label":             "High LP (Direct Threshold)",
        "short":             "High LP",
        "description":       "Directly selects the top X% of edges with the highest LP scores as backbone. No Isolation Forest is used.",
        "function":          None,
        "kwargs":            {},
        "score_column":      "local_path_index_1",
        "requires_anomaly":  True,
        "requires_preprocessing": False,
        "selection_method":  "direct_high",
        "derives_from":      "lp",
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#DC2626",
    },
    "low_lp": {
        "label":             "Low LP (Direct Threshold)",
        "short":             "Low LP",
        "description":       "Directly selects the bottom X% of edges with the lowest LP scores as backbone. No Isolation Forest is used.",
        "function":          None,
        "kwargs":            {},
        "score_column":      "local_path_index_1",
        "requires_anomaly":  True,
        "requires_preprocessing": False,
        "selection_method":  "direct_low",
        "derives_from":      "lp",
        "default_threshold": None,
        "threshold_direction": None,
        "color":             "#EA580C",
    },
}