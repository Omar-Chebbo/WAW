# Network Backbone Explorer

An interactive web application for network backbone extraction and evaluation, developed as part of a Master 2 Data Science thesis on network backbone methods.

Built on top of the WAW2025 research codebase.

---

## Requirements

- Python 3.10+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (recommended package manager)
- Optional but recommended for large Step 6 networks: Graphviz installed on your system and available in PATH. Step 6 will use Graphviz `sfdp` when available to create clearer layouts for large non-geographic networks. If Graphviz is missing, the app falls back to a deterministic NetworkX layout.

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
| 6 | **Visual Comparison** — full unsampled comparison with one-panel toggle: score extremes (lowest 20% blue, highest 20% red) or Isolation Forest backbone overlay (purple), using the same node positions |
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

## Step 6 visualization update

The Step 6 visualization now uses the full selected network instead of the Step 1 preview sample. For each ready method, the app loads one shared layout and reuses it for two toggle views:

1. **Score extremes**: all original edges are shown in black, the lowest 20% of the selected method score are blue, and the highest 20% are red.
2. **IF backbone**: all original edges are shown in black, and the Isolation Forest selected backbone edges are purple.

The export button exports the currently selected view separately as a high-quality PDF, SVG, or 600 dpi PNG. This avoids forcing the original and backbone views into one crowded figure.

## Multi-feature lab additions (October 2026)

- **Multi-Feature Novelty** is displayed in the **Common and unique structure** panel. It is the fraction of PA+LP selected edges that are absent from **both** the PA-only and LP-only backbones: `|E_PA+LP \\ (E_PA ∪ E_LP)| / |E_PA+LP|`. An empty PA+LP backbone produces `null` / N/A. A dedicated **Export novelty CSV** link saves the reported value with the achieved retention fraction.
- **Export publication PNG** in the **PA+LP backbone score fingerprint** panel creates a white-background, journal-style 3×3 fingerprint image from the current experiment values, rather than capturing the dashboard. It includes dataset, achieved retention, region thresholds, counts and percentages and renders at **3300 × 2580 pixels**. The display in the lab is unchanged.

These additions do not change the Isolation Forest edge selection or existing experimental calculations. Install and launch the application as described above. Frontend packages are not bundled into this source ZIP; install them using `npm ci` in `frontend/`.

## Multi-feature journal heatmap export (v3)

In **Experiment Lab > Multi-Feature**, run an experiment and scroll to **PA+LP backbone score fingerprint**. Select **Export publication heatmap PNG** to save a **3600 × 2820 px** PNG generated from experiment data. Colors show the fraction of edges selected **within each PA–LP region** (`selected_count / total_count`) on a fixed 0–100% scale. Cell labels show `selected / total` and the percentage. Empty regions display `N/A`. This publication export is separate from the interactive fingerprint, which remains unchanged.

The earlier **Multi-Feature Novelty** metric remains available in **Common and Unique Structure** along with its CSV export.

**Important: rebuild frontend to see v3.** The archived `backend/static` directory from older versions is deliberately removed from this ZIP so an outdated production interface cannot be mistaken for the new features. Install dependencies and build from `frontend/`:

```sh
cd frontend
npm ci
npm run build
cd ..
uvicorn backend.main:app --reload --port 8000
```

Alternatively run `npm run dev` in `frontend/` with the API running on port 8000, and open http://localhost:5173. A production build creates `backend/static` for FastAPI automatically. These commands need an internet-connected environment for the initial npm dependency installation. The v3 source was syntax-checked, but the complete frontend build could not run in the packaging environment because package downloads were unavailable.

## Corrected exports (October 27, 2026 — verified v3)

**The ZIP includes a ready-to-serve frontend** in `backend/static/` with versioned JavaScript and CSS. You **do not need to run `npm run build`** to use the corrected app when running it through FastAPI. This bundle was patched and checked directly because npm packages could not be fetched in the build environment. If you do rebuild on your own machine, source edits are also included in `frontend/src/`.

1. Extract this ZIP to a **new, empty directory**, not over your previous installation.
2. Stop any old running FastAPI/Vite instances.
3. In the new `project/` directory, run `uv run uvicorn backend.main:app --port 8000` or double-click `START_CORRECTED_WINDOWS.bat` if dependencies are installed.
4. Open `http://localhost:8000` and perform a hard refresh (Ctrl+Shift+R).
5. If your UI still has positive PA/LP anomaly plots, use **View Page Source** to check that `index-CorrectedFrontend-v3.js` is loaded; otherwise you are running an older copy.

The Multi-Feature PA/LP scatter and its PNG/SVG/PDF exports now use negative `score_samples`, with the more anomalous edges below the cutoff. The exported publication heatmap displays split, centered two-line row/column labels and a right-side 0–100% selection-rate gradient legend. The Local Path epsilon remains 1 (`alpha=1` in code).


## Contamination Lab: full evaluation, PA+LP novelty and Excel exports (Oct 28, 2026)

- Select **PA+LP** in Experiment Lab > Contamination and choose any list of backbone percentages. PA and LP single-feature studies remain available.
- Each run now provides **all nine Wizard Step 7 metrics** in the **All Wizard evaluation properties by contamination** table: edge/node percentage, reachability, connected components, signed transitivity and average-clustering deviations, degree/weight entropy, and average path length.
- For PA+LP, a separate **multi-feature novelty by contamination** table and two charts compare joint PA+LP against PA-only and LP-only at **the same selection percentage**. The novelty fraction is `|E_PA+LP \ (E_PA ∪ E_LP)| / |E_PA+LP|`.
- **Download properties Excel (.xlsx)** and **Download novelty Excel (.xlsx)** export independent, filterable numerical workbooks. The exported data comes from the current experiment results: it does not recompute scores.
- All three IF rankings are fitted once per PA+LP contamination experiment, then sliced at each requested percentage. Preprocessing defaults to raw. The Python Excel writer needs no new dependency.
- **Important:** the frontend source has changed. In the project directory run `cd frontend`, `npm ci`, `npm run build`, then start FastAPI; or use the updated `START_CORRECTED_WINDOWS.bat` which builds the frontend before starting the server.
