# Network Backbone Explorer

An interactive web application for network backbone extraction and evaluation, developed as part of a Master 2 Data Science thesis on network backbone methods.

Built on top of the WAW2025 research codebase.

---

## Requirements

- Python 3.10+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (recommended package manager)

---

## Installation & Setup

### Using `uv` (recommended)

```bash
# Install uv if you don't have it
# Windows:
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
# Mac/Linux:
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Python packages
uv sync

# Install and build the frontend
cd frontend && npm install && npm run build && cd ..

# Start the app
uv run uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000** in your browser.


### Development mode (hot reload on both frontend and backend)

```bash
# Terminal 1 — backend
uv run uvicorn backend.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Frontend runs at **http://localhost:5173**, API at **http://localhost:8000/docs**.

---

## Project Structure

```
app/
├── backend/                  # Python FastAPI server
│   ├── main.py               # Entry point
│   ├── api/                  # REST + WebSocket endpoints
│   │   ├── datasets.py       # Dataset upload & listing
│   │   ├── scores.py         # Score computation trigger
│   │   ├── anomalies.py      # Anomaly labeling
│   │   ├── backbone.py       # Backbone extraction
│   │   ├── evaluation.py     # Structural metrics
│   │   └── websockets.py     # Real-time progress streaming
│   ├── services/             # Business logic layer
│   ├── core/                 # Algorithm implementations
│   │   ├── methods.py        # HSS, DF, PA, LP + METHOD_REGISTRY
│   │   ├── anomaly.py        # Isolation Forest labeling
│   │   └── evaluation.py     # Structural metrics + METRIC_REGISTRY
│   └── config.py             # Paths and constants
├── frontend/                 # React + TypeScript app
│   └── src/
│       ├── pages/            # 7 wizard steps
│       ├── components/       # Reusable UI components
│       ├── store/            # Zustand global state
│       └── api/              # Typed API client
├── data/
│   └── raw/                  # Pre-loaded datasets
├── pyproject.toml            # Python dependencies (uv)
└── start.bat                 # One-command Windows setup
```

---

## The 7-Step Workflow

| Step | Description |
|------|-------------|
| 1 | **Data Selection** — pick a pre-loaded network or upload your own CSV |
| 2 | **Method Selection** — choose HSS, DF, PA, LP (or all) |
| 3 | **Score Computation** — real-time progress bars via WebSocket |
| 4 | **Anomaly Labeling** — Isolation Forest ranking with adjustable backbone percentage slider |
| 5 | **Backbone Extraction** — node/edge retention statistics |
| 6 | **Visual Comparison** — interactive D3 graphs, side-by-side or overlay |
| 7 | **Evaluation** — metrics table + radar chart, CSV export |

---

## Extending the App

### Add a new backbone method

1. Write `my_method(graph, progress_cb=None)` in `backend/core/methods.py`
2. Add an entry to `METHOD_REGISTRY` in the same file
3. Add a matching entry to `METHODS` in `frontend/src/constants/methods.ts`

### Add a new evaluation metric

1. Write `my_metric(original, backbone)` in `backend/core/evaluation.py`
2. Add an entry to `METRIC_REGISTRY` in the same file

---

## Pre-loaded Datasets

| Dataset | Description |
|---------|-------------|
| `airports.csv` | Global airport connections |
| `openflights.csv` | OpenFlights route network |
| `job_mobility_network_09_10.csv` | Job mobility flows |
| `toth-elementary-school.csv` | School contact network |
| `lesmis.csv` | Les Misérables character co-occurrence |


## Updated contamination / backbone-percentage logic

In this version, contamination is interpreted as the percentage of edges to keep in the backbone.
For PA, LP, and PA+LP anomaly-based methods, the app now:

1. computes the PA/LP/PA+LP feature vector for every observed edge,
2. fits Isolation Forest once to obtain an anomaly ranking,
3. sorts edges from most anomalous to least anomalous,
4. keeps the top `contamination × |E|` edges as the backbone.

Example: `0.25` keeps approximately the top 25% most anomalous edges. The old Isolation Forest threshold / `predict()` cutoff is no longer used to choose backbone edges.
