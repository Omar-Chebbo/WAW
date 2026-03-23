"""
backend/services/evaluation_service.py
Runs structural metrics comparing each backbone to the original graph.
"""
import json
import networkx as nx
import pandas as pd
from pathlib import Path

from backend.core.evaluation import METRIC_REGISTRY, run_all_metrics, compute_distributions
from backend.config import SESSIONS_DIR
from backend.services.graph_service import load_graph
from backend.services.score_service import load_scores


def run_evaluation(
    session_id: str,
    dataset_path: Path,
    method_ids: list,
    metric_ids: list,
) -> dict:
    """
    Compare every requested backbone against the original graph.
    Returns { method_id: { metric_id: { label, value, deviation } } }
    and saves results to evaluation.json in the session folder.
    """
    original = load_graph(dataset_path)
    report   = {}

    for method_id in method_ids:
        # Load the backbone
        try:
            backbone_path = SESSIONS_DIR / session_id / "backbones" / f"{method_id}.json"
            with open(backbone_path) as f:
                bj = json.load(f)
            # Reconstruct networkx graph from the D3 JSON
            backbone = nx.node_link_graph(bj) if "graph" in bj else _json_to_graph(bj)
        except FileNotFoundError:
            # Fallback: try to extract on the fly from scored data
            from backend.services.backbone_service import extract_backbone
            extract_backbone(session_id, method_id)
            backbone_path = SESSIONS_DIR / session_id / "backbones" / f"{method_id}.json"
            with open(backbone_path) as f:
                bj = json.load(f)
            backbone = _json_to_graph(bj)

        report[method_id] = run_all_metrics(original, backbone, metric_ids)

    # Save to disk
    out = SESSIONS_DIR / session_id / "evaluation.json"
    with open(out, "w") as f:
        json.dump(report, f)

    return report


def load_evaluation(session_id: str) -> dict:
    """Load a previously computed evaluation report."""
    path = SESSIONS_DIR / session_id / "evaluation.json"
    if not path.exists():
        raise FileNotFoundError("Evaluation not run yet.")
    with open(path) as f:
        return json.load(f)


def evaluation_to_csv(session_id: str) -> str:
    """Convert the evaluation report to a CSV string for download."""
    report = load_evaluation(session_id)
    rows   = []
    for method_id, metrics in report.items():
        row = {"method": method_id}
        for metric_id, data in metrics.items():
            row[f"{data['label']} (value)"]     = data["value"]
            row[f"{data['label']} (deviation)"] = data["deviation"]
        rows.append(row)
    return pd.DataFrame(rows).to_csv(index=False)


def _json_to_graph(data: dict) -> nx.Graph:
    """Convert D3 node-link JSON back to a networkx Graph."""
    G = nx.Graph()
    for node in data.get("nodes", []):
        G.add_node(node["id"])
    for link in data.get("links", []):
        G.add_edge(link["source"], link["target"], weight=link.get("weight", 1))
    return G

def run_distributions(
    session_id: str,
    dataset_path: Path,
    method_ids: list,
) -> dict:
    """
    For each backbone method, compute degree and weight distribution comparison
    against the original graph and return KS statistics.
    Returns { method_id: { degree: {...}, weight: {...} } }
    """
    original = load_graph(dataset_path)
    result = {}

    for method_id in method_ids:
        backbone_path = SESSIONS_DIR / session_id / "backbones" / f"{method_id}.json"
        if not backbone_path.exists():
            continue
        with open(backbone_path) as f:
            bj = json.load(f)
        backbone = _json_to_graph(bj)
        result[method_id] = compute_distributions(original, backbone)

    return result