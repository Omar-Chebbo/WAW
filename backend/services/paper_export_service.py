from __future__ import annotations

import io
import math
import textwrap
from typing import Any

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import patheffects as pe
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter, MaxNLocator
import networkx as nx
import numpy as np


PAPER_RC = {
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'axes.edgecolor': '#4B5563',
    'axes.labelcolor': '#0F172A',
    'axes.titlesize': 11,
    'axes.titleweight': 'bold',
    'axes.labelsize': 10.5,
    'xtick.color': '#334155',
    'ytick.color': '#334155',
    'xtick.labelsize': 8.5,
    'ytick.labelsize': 8.5,
    'grid.color': '#D7DEE8',
    'grid.linestyle': ':',
    'grid.linewidth': 0.7,
    'legend.frameon': False,
    'legend.fontsize': 8.5,
    'font.family': 'serif',
    'font.serif': ['STIXGeneral', 'Times New Roman', 'DejaVu Serif'],
    'mathtext.fontset': 'stix',
    'axes.unicode_minus': False,
    'pdf.fonttype': 42,
    'ps.fonttype': 42,
    'svg.fonttype': 'none',
    'lines.linewidth': 1.8,
    'patch.linewidth': 0.5,
}

PALETTE = ['#1F2937', '#1D4ED8', '#B45309', '#0F766E', '#7C3AED', '#9A3412']
LINESTYLES = ['-', '--', '-.', ':', (0, (5, 1)), (0, (3, 1, 1, 1))]
ACCENT = '#1D4ED8'
NORMAL = '#D1D5DB'
TEXT = '#0F172A'
SUBTEXT = '#475569'
GRID = '#E2E8F0'


def _apply_style():
    plt.rcParams.update(PAPER_RC)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        num = float(value)
        if math.isfinite(num):
            return num
    except Exception:
        pass
    return default


def _slugify(text: str) -> str:
    out = ''.join(ch.lower() if ch.isalnum() else '-' for ch in text.strip())
    while '--' in out:
        out = out.replace('--', '-')
    return out.strip('-') or 'figure'


def _series_color(series: dict[str, Any], default: str = ACCENT) -> str:
    return series.get('color') or default


def _save_figure(fig, fmt: str) -> bytes:
    buf = io.BytesIO()
    fmt = fmt.lower()
    # Use tight bbox with padding so legends / annotations placed outside
    # axes (via bbox_to_anchor) are always included.  Without tight bbox
    # such content overflows the page and produces an invalid / corrupt PDF
    # that Adobe Acrobat cannot open.
    savefig_kw: dict[str, Any] = {'bbox_inches': 'tight', 'pad_inches': 0.15}
    if fmt == 'png':
        fig.savefig(buf, format='png', dpi=600, **savefig_kw)
    elif fmt == 'svg':
        fig.savefig(buf, format='svg', **savefig_kw)
    elif fmt == 'pdf':
        fig.savefig(buf, format='pdf', metadata={'Date': None}, **savefig_kw)
    else:
        raise ValueError(f'Unsupported export format: {fmt}')
    buf.flush()
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def _finalize(fig, fmt: str) -> bytes:
    return _save_figure(fig, fmt)


def _compute_layout(graph: nx.Graph, seed: int = 42):
    if graph.number_of_nodes() == 0:
        return {}
    if graph.number_of_nodes() == 1:
        node = next(iter(graph.nodes))
        return {node: (0.0, 0.0)}
    n = max(graph.number_of_nodes(), 2)
    return nx.spring_layout(graph, seed=seed, k=max(0.18, 2.0 / math.sqrt(n)), iterations=250)


def _build_graph(graph_data: dict[str, Any]) -> nx.Graph:
    g = nx.Graph()
    for node in graph_data.get('nodes', []):
        node_id = str(node.get('id'))
        attrs = {'degree': _safe_float(node.get('degree'))}
        if node.get('x') is not None and node.get('y') is not None:
            attrs['x'] = _safe_float(node.get('x'))
            attrs['y'] = _safe_float(node.get('y'))
        g.add_node(node_id, **attrs)
    for link in graph_data.get('links', []):
        source = link.get('source')
        target = link.get('target')
        if isinstance(source, dict):
            source = source.get('id')
        if isinstance(target, dict):
            target = target.get('id')
        if source is None or target is None:
            continue
        attrs = dict(link)
        attrs.pop('source', None)
        attrs.pop('target', None)
        attrs['weight'] = _safe_float(attrs.get('weight'), 1.0)
        g.add_edge(str(source), str(target), **attrs)
    return g


def _positions_from_graph_data(graph_data: dict[str, Any]) -> dict[str, tuple[float, float]]:
    positions = {}
    for node in graph_data.get('nodes', []):
        if node.get('x') is None or node.get('y') is None:
            continue
        positions[str(node.get('id'))] = (_safe_float(node.get('x')), _safe_float(node.get('y')))
    return positions

def _wrap(text: Any, width: int = 22) -> str:
    text = str(text)
    if not text:
        return ''
    if len(text) <= width:
        return text
    return '\n'.join(textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False))


# readable axis formatter for wide score ranges

def _human_tick(value, _pos=None):
    value = float(value)
    abs_val = abs(value)
    if abs_val >= 1_000_000:
        return f'{value/1_000_000:.1f}M'
    if abs_val >= 1_000:
        return f'{value/1_000:.1f}k'
    if abs_val >= 100:
        return f'{value:.0f}'
    if abs_val >= 1:
        return f'{value:.1f}'
    if abs_val == 0:
        return '0'
    return f'{value:.2g}'


def _style_axes(ax, *, x_label: str | None = None, y_label: str | None = None, grid_axis: str = 'y'):
    if x_label:
        ax.set_xlabel(x_label, labelpad=8)
    if y_label:
        ax.set_ylabel(y_label, labelpad=8)
    ax.grid(True, axis=grid_axis, color=GRID, linewidth=0.8, linestyle=':')
    ax.spines[['top', 'right']].set_visible(False)
    ax.spines['left'].set_color('#64748B')
    ax.spines['bottom'].set_color('#64748B')
    ax.tick_params(axis='both', colors='#334155', length=4, width=0.8)


def _apply_title(fig, title: str | None, subtitle: str | None = None):
    # Subtitle intentionally disabled for exported figures.
    if title:
        # y=0.95 keeps the title safely within the figure boundary
        # (previously 0.98 caused clipping when bbox_inches is not tight)
        fig.suptitle(title, x=0.08, y=0.95, ha='left', va='top', fontsize=11.5, fontweight='bold', color=TEXT)


def _legend_above(ax, ncol: int = 2, *, y: float = 1.10):
    handles, labels = ax.get_legend_handles_labels()
    if not handles:
        return
    ax.legend(
        handles,
        labels,
        loc='upper center',
        bbox_to_anchor=(0.5, y),
        ncol=min(max(ncol, 1), max(len(labels), 1)),
        frameon=False,
        borderaxespad=0.2,
        columnspacing=1.1,
        handletextpad=0.5,
    )


def _reserve_paper_margins(fig, *, top: float = 0.84, bottom: float = 0.16, left: float = 0.11, right: float = 0.98):
    fig.subplots_adjust(top=top, bottom=bottom, left=left, right=right)


def _maybe_symlog(ax, values: np.ndarray, axis: str):
    vals = np.asarray(values, dtype=float)
    vals = vals[np.isfinite(vals)]
    if len(vals) < 5:
        return
    if np.any(vals < 0):
        return
    positive = vals[vals > 0]
    if len(positive) < 5:
        return
    p50 = np.percentile(positive, 50)
    p95 = np.percentile(positive, 95)
    vmax = float(np.max(positive))
    if p50 <= 0:
        return
    if vmax / max(p50, 1e-9) < 25 and p95 / max(p50, 1e-9) < 12:
        return
    linthresh = max(1.0, float(np.percentile(positive, 20)))
    if axis == 'x':
        ax.set_xscale('symlog', linthresh=linthresh)
    else:
        ax.set_yscale('symlog', linthresh=linthresh)


def render_histogram(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Histogram')
    bins = payload.get('bins', [])
    x_label = payload.get('x_label', 'Value')
    y_label = payload.get('y_label', 'Count')
    anomaly_key = payload.get('anomaly_key', 'anomalies')
    normal_key = payload.get('normal_key', 'normal')
    total_key = payload.get('total_key', 'count')
    anomaly_label = payload.get('anomaly_label', 'Anomaly')
    normal_label = payload.get('normal_label', 'Normal')
    accent = payload.get('accent_color', ACCENT)
    normal_color = payload.get('normal_color', NORMAL)

    centers = np.array([_safe_float(row.get('bin_center', row.get('bin', idx))) for idx, row in enumerate(bins)], dtype=float)
    if bins and 'bin_left' in bins[0] and 'bin_right' in bins[0]:
        widths = np.array([max(_safe_float(row.get('bin_right')) - _safe_float(row.get('bin_left')), 1e-9) for row in bins], dtype=float)
    else:
        diffs = np.diff(np.sort(centers)) if len(centers) > 1 else np.array([1.0])
        base = float(np.median(diffs)) if len(diffs) else 1.0
        widths = np.array([base * 0.86 for _ in centers], dtype=float)

    anomaly = np.array([_safe_float(row.get(anomaly_key)) for row in bins], dtype=float) if bins else np.array([])
    normal = np.array([_safe_float(row.get(normal_key)) for row in bins], dtype=float) if bins else np.array([])
    total = np.array([_safe_float(row.get(total_key, row.get('count'))) for row in bins], dtype=float) if bins else np.array([])

    fig, ax = plt.subplots(figsize=(6.8, 4.8))
    _apply_title(fig, title, payload.get('subtitle'))
    # top=0.88 ensures the legend (at bbox y=1.06) fits within the figure
    _reserve_paper_margins(fig, top=0.88, bottom=0.16, left=0.12, right=0.98)
    has_split = len(anomaly) and (anomaly.sum() > 0 or normal.sum() > 0)

    if has_split:
        selected_n = int(anomaly.sum())
        total_n = int(anomaly.sum() + normal.sum())
        ax.bar(centers, normal, width=widths, color=normal_color, edgecolor='white', linewidth=0.45, label=f'{normal_label} (n={int(normal.sum())})', zorder=2)
        ax.bar(centers, anomaly, width=widths, bottom=normal, color=accent, edgecolor='white', linewidth=0.45, label=f'{anomaly_label} (n={selected_n}, {100.0*selected_n/max(total_n,1):.1f}%)', zorder=3)
        _legend_above(ax, ncol=2, y=1.06)
    else:
        ax.bar(centers, total, width=widths, color=accent, edgecolor='white', linewidth=0.45, zorder=3, label=payload.get('single_label', 'Count'))
        if payload.get('single_label'):
            _legend_above(ax, ncol=1, y=1.06)

    _style_axes(ax, x_label=x_label, y_label=y_label, grid_axis='y')
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))
    ax.xaxis.set_major_formatter(FuncFormatter(_human_tick))
    _maybe_symlog(ax, centers, 'x')
    ax.margins(x=0.02)
    return _finalize(fig, fmt)


def render_bar(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Bar chart')
    rows = payload.get('rows', [])
    x_key = payload.get('x_key', 'label')
    series = payload.get('series', [])
    horizontal = payload.get('horizontal', False)
    x_labels = [str(row.get(x_key, '')) for row in rows]

    fig_w = max(6.8, min(10.5, 1.0 + 0.58 * max(len(x_labels), 4)))
    fig, ax = plt.subplots(figsize=(fig_w, 4.8))
    _apply_title(fig, title, payload.get('subtitle'))
    # top=0.88 ensures the legend (at bbox y=1.06) fits within the figure
    _reserve_paper_margins(fig, top=0.88, bottom=0.22 if not horizontal else 0.14, left=0.13 if horizontal else 0.10, right=0.98)
    indices = np.arange(len(rows))

    if not series:
        series = [{'key': payload.get('y_key', 'value'), 'label': payload.get('y_label', 'Value'), 'color': payload.get('accent_color', ACCENT)}]

    width = 0.76 / max(len(series), 1)
    for i, spec in enumerate(series):
        vals = np.array([_safe_float(r.get(spec['key'])) for r in rows], dtype=float)
        color = _series_color(spec, PALETTE[i % len(PALETTE)])
        label = spec.get('label', spec['key'])
        if horizontal:
            ax.barh(indices + (i - (len(series)-1)/2)*width, vals, height=width, color=color, label=label, edgecolor='white', linewidth=0.7, zorder=3)
        else:
            ax.bar(indices + (i - (len(series)-1)/2)*width, vals, width=width, color=color, label=label, edgecolor='white', linewidth=0.7, zorder=3)

    wrapped_labels = [_wrap(x, 16 if not horizontal else 26) for x in x_labels]
    if horizontal:
        ax.set_yticks(indices)
        ax.set_yticklabels(wrapped_labels)
        _style_axes(ax, x_label=payload.get('y_axis_label', 'Value'), grid_axis='x')
    else:
        ax.set_xticks(indices)
        rotation = payload.get('x_rotation')
        if rotation is None:
            rotation = 0 if max((len(x) for x in x_labels), default=0) < 12 else 20
        ax.set_xticklabels(wrapped_labels, rotation=rotation, ha='right' if rotation else 'center')
        _style_axes(ax, y_label=payload.get('y_axis_label', 'Value'), grid_axis='y')
    ax.yaxis.set_major_locator(MaxNLocator(integer=payload.get('integer_y', False)))
    if any(spec.get('label') for spec in series):
        _legend_above(ax, ncol=min(len(series), 3), y=1.06)
    return _finalize(fig, fmt)


def render_line(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Line chart')
    rows = payload.get('rows', [])
    x_key = payload.get('x_key', 'x')
    series = payload.get('series', [])
    x_label = payload.get('x_label', x_key)
    y_label = payload.get('y_label', 'Value')
    x_values = [row.get(x_key) for row in rows]
    fig, ax = plt.subplots(figsize=(6.8, 4.8))
    _apply_title(fig, title, payload.get('subtitle'))
    # top=0.88 ensures the legend (at bbox y=1.06) fits within the figure
    _reserve_paper_margins(fig, top=0.88, bottom=0.16, left=0.12, right=0.98)
    categorical = any(isinstance(v, str) for v in x_values)
    plotted_any = False
    for i, spec in enumerate(series):
        y = [_safe_float(r.get(spec['key'])) for r in rows]
        color = _series_color(spec, PALETTE[i % len(PALETTE)])
        label = spec.get('label', spec['key'])
        style = spec.get('style', LINESTYLES[i % len(LINESTYLES)])
        marker = spec.get('marker', 'o' if len(rows) <= 10 else None)
        ax.plot(x_values, y, label=label, color=color, linewidth=1.8, linestyle=style, marker=marker, markersize=3.8, zorder=3)
        plotted_any = True
    if payload.get('vline_x') is not None:
        ax.axvline(payload.get('vline_x'), color='#64748B', linestyle='--', linewidth=1.0, zorder=2)
    if payload.get('hline_y') is not None:
        ax.axhline(payload.get('hline_y'), color='#64748B', linestyle='--', linewidth=1.0, zorder=2)
    _style_axes(ax, x_label=x_label, y_label=y_label, grid_axis='both')
    if not categorical:
        ax.xaxis.set_major_locator(MaxNLocator(nbins=min(max(len(rows), 4), 8)))
        ax.yaxis.set_major_formatter(FuncFormatter(_human_tick))
        _maybe_symlog(ax, np.asarray([_safe_float(v) for v in x_values], dtype=float), 'x')
        for spec in series:
            _maybe_symlog(ax, np.asarray([_safe_float(r.get(spec['key'])) for r in rows], dtype=float), 'y')
    else:
        for tick in ax.get_xticklabels():
            tick.set_rotation(18)
            tick.set_ha('right')
    if plotted_any:
        _legend_above(ax, ncol=max(1, min(len(series), 3)), y=1.06)
    return _finalize(fig, fmt)


def _is_background_label(label: str) -> bool:
    """Check if a group label represents non-backbone / background points."""
    return label.lower().strip() in {'not selected', 'normal', 'non-backbone', 'non_backbone', 'non selected', 'not_selected'}


def _normalize_bg_label(label: str) -> str:
    """Map various background labels to a canonical 'Non-backbone' for the legend."""
    if _is_background_label(label):
        return 'Non-backbone'
    return label


def render_scatter(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Scatter plot')
    rows = payload.get('rows', [])
    x_key = payload.get('x_key', 'x')
    y_key = payload.get('y_key', 'y')
    group_key = payload.get('group_key')
    groups = payload.get('groups', [])
    x_label = payload.get('x_label', x_key)
    y_label = payload.get('y_label', y_key)
    is_pdf = fmt.lower() == 'pdf'
    # Use a larger figure for PDF to match the visual quality of the Plotly PNG export
    fig_width = 8.5 if is_pdf else 6.8
    fig_height = 6.0 if is_pdf else 4.6
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    _apply_title(fig, title, payload.get('subtitle'))
    top_margin = 0.82 if payload.get('subtitle') else 0.85
    # Wider margins for PDF to accommodate larger labels
    if is_pdf:
        _reserve_paper_margins(fig, top=top_margin, bottom=0.11, left=0.10, right=0.96)
    else:
        _reserve_paper_margins(fig, top=top_margin, bottom=0.16, left=0.12, right=0.96)
    # For PDF: scale up marker sizes and font sizes to match Plotly interactive quality
    size_scale = 3.5 if is_pdf else 1.0
    font_scale = 1.45 if is_pdf else 1.0
    if group_key:
        values = {row.get(group_key) for row in rows}
        if not groups:
            groups = [{'value': value, 'label': str(value), 'color': PALETTE[i % len(PALETTE)]} for i, value in enumerate(sorted(values, key=lambda x: str(x)))]
        # --- Identify background (non-backbone / non-selected / normal) groups ---
        # Draw background FIRST so backbone points are rendered on top.
        ordered = sorted(groups, key=lambda g: 0 if _is_background_label(str(g.get('label', g.get('value', '')))) else 1)
        for i, spec in enumerate(ordered):
            filtered = [row for row in rows if row.get(group_key) == spec['value']]
            if not filtered:
                continue
            xs = [_safe_float(r.get(x_key)) for r in filtered]
            ys = [_safe_float(r.get(y_key)) for r in filtered]
            is_background = _is_background_label(str(spec.get('label', spec.get('value', ''))))
            n_points = len(filtered)
            # Use a canonical legend label so the legend always reads "Non-backbone"
            # instead of the raw frontend label like "not selected".
            legend_label = _normalize_bg_label(str(spec.get('label', spec['value'])))
            if is_background:
                # Non-backbone points: clearly visible medium-gray markers with a
                # thin white outline so they remain distinguishable even where
                # backbone dots overlap them.
                marker_size = 16 * size_scale
                alpha_val = 0.78
                bg_color = spec.get('color')
                if not bg_color or bg_color == ACCENT:
                    bg_color = '#78909C'
                point_color = bg_color
                draw_zorder = 2  # behind backbone
                edge_color = 'white'
                edge_width = 0.4
            else:
                marker_size = 22 * size_scale
                alpha_val = 0.92
                point_color = spec.get('color', PALETTE[i % len(PALETTE)])
                draw_zorder = 3  # on top
                edge_color = 'white'
                edge_width = 0.3
            # For PDF with many points, rasterize to avoid bloated vector output
            rasterize = is_pdf and n_points > 2000
            ax.scatter(xs, ys, s=marker_size, alpha=alpha_val, color=point_color, label=legend_label, edgecolors=edge_color, linewidths=edge_width, zorder=draw_zorder, rasterized=rasterize)
        legend_fontsize = 10.0 * font_scale
        # Legend on the right side of the plot (outside axes).
        # bbox_inches='tight' in _save_figure ensures this is captured in the PDF.
        ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1.0), frameon=True, fontsize=legend_fontsize, borderaxespad=0.4, handletextpad=0.5, edgecolor='#CBD5E1', fancybox=True, shadow=False)
    else:
        ax.scatter([_safe_float(r.get(x_key)) for r in rows], [_safe_float(r.get(y_key)) for r in rows], s=34 * size_scale, alpha=0.85, color=payload.get('accent_color', ACCENT), edgecolors='none', linewidths=0, zorder=3, rasterized=is_pdf and len(rows) > 2000)
    if payload.get('vline_x') is not None:
        ax.axvline(_safe_float(payload['vline_x']), color='#64748B', linestyle='--', linewidth=1.0, zorder=2)
    if payload.get('hline_y') is not None:
        ax.axhline(_safe_float(payload['hline_y']), color='#64748B', linestyle='--', linewidth=1.0, zorder=2)
    _style_axes(ax, x_label=x_label, y_label=y_label, grid_axis='both')
    # Scale tick label sizes for PDF
    if is_pdf:
        ax.tick_params(axis='both', labelsize=9.5 * font_scale)
        ax.xaxis.label.set_fontsize(11.5 * font_scale)
        ax.yaxis.label.set_fontsize(11.5 * font_scale)
    ax.xaxis.set_major_formatter(FuncFormatter(_human_tick))
    ax.yaxis.set_major_formatter(FuncFormatter(_human_tick))
    _maybe_symlog(ax, np.asarray([_safe_float(r.get(x_key)) for r in rows], dtype=float), 'x')
    _maybe_symlog(ax, np.asarray([_safe_float(r.get(y_key)) for r in rows], dtype=float), 'y')
    return _finalize(fig, fmt)

# Manuscript Figure 2: one standalone panel, assembled with LaTeX later.
# The raw PA/LP values and *single-feature* sklearn score_samples are used.
FIGURE2_COLORS = {'pa': '#1D4ED8', 'lp': '#B45309'}


def render_paper_score_scatter(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    method = str(payload.get('method', '')).lower()
    if method not in FIGURE2_COLORS:
        raise ValueError('paper_score_scatter requires method pa or lp')
    rows = payload.get('rows', [])
    if not isinstance(rows, list) or not rows:
        raise ValueError('paper_score_scatter requires rows')
    x_key = payload.get('x_key', 'x')
    y_key = payload.get('y_key', 'y')
    x_label = payload.get('x_label', x_key)
    y_label = payload.get('y_label', y_key)
    rho = float(payload.get('rho', 0.20))
    if not (0 < rho <= 0.5):
        raise ValueError('rho must be in (0, 0.5]')
    anomaly_direction = str(payload.get('anomaly_direction', 'high')).lower()
    if anomaly_direction not in {'high', 'low'}:
        raise ValueError('anomaly_direction must be high or low')
    coords = []
    for idx, row in enumerate(rows):
        try:
            x, y = float(row[x_key]), float(row[y_key])
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f'Invalid score for scatter row {idx}: {exc}') from exc
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError(f'Nonfinite score at scatter row {idx}')
        coords.append((x, y))
    coords = np.asarray(coords, dtype=float)
    count = max(1, int(math.ceil(rho * len(coords))))
    if anomaly_direction == 'high':
        ordered = np.argsort(-coords[:, 1], kind='mergesort')
    else:
        ordered = np.argsort(coords[:, 1], kind='mergesort')
    cutoff = float(coords[ordered[count - 1], 1])
    fig, ax = plt.subplots(figsize=(4.4, 3.15))
    fig.subplots_adjust(left=0.19, right=0.97, bottom=0.20, top=0.96)
    point_count = len(coords)
    if point_count >= 12000:
        marker_size, alpha_val = 3.4, 0.20
    elif point_count >= 6000:
        marker_size, alpha_val = 4.4, 0.26
    elif point_count >= 2500:
        marker_size, alpha_val = 5.4, 0.34
    else:
        marker_size, alpha_val = 7.0, 0.48
    ax.scatter(coords[:, 0], coords[:, 1], s=marker_size, alpha=alpha_val,
               color=FIGURE2_COLORS[method], marker='o', linewidths=0, edgecolors='none',
               rasterized=(fmt.lower() == 'pdf' and point_count > 4000))
    ax.axhline(cutoff, linestyle='--', color='#374151', linewidth=1.15, zorder=4)
    ax.set_xlabel(x_label, fontsize=10)
    ax.set_ylabel(y_label, fontsize=10)
    ax.tick_params(labelsize=8.5)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(False)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=5))
    ax.yaxis.set_major_locator(MaxNLocator(nbins=5))
    ax.xaxis.set_major_formatter(FuncFormatter(_human_tick))
    ax.yaxis.set_major_formatter(FuncFormatter(_human_tick))
    return _finalize(fig, fmt)


def render_single_score_iforest(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    method = str(payload.get('method', '')).lower()
    if method not in FIGURE2_COLORS:
        raise ValueError('Figure 2 accepts only single-feature method pa or lp, not PA+LP')
    rho = float(payload.get('rho', 0.20))
    if not (0 < rho <= 0.5):
        raise ValueError('rho must be in (0, 0.5]')
    if not payload.get('raw_scores', True):
        raise ValueError('Figure 2 requires raw, untransformed scores for model fitting')
    rows = payload.get('rows', [])
    if not isinstance(rows, list) or not rows:
        raise ValueError('Figure 2 requires all observed edge rows')
    coords = []
    for idx, row in enumerate(rows):
        try:
            x, y = float(row['x']), float(row['y'])
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f'Invalid score for edge row {idx}: {exc}') from exc
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError(f'Nonfinite score at edge row {idx}')
        coords.append((x, y))
    coords = np.asarray(coords, dtype=float)
    # Deterministic stable ranking matches anomaly.py and keeps exactly ceil(rho * m).
    # Tied y-scores remain indistinguishable from the horizontal line alone.
    count = max(1, int(math.ceil(rho * len(coords))))
    ordered = np.argsort(coords[:, 1], kind='mergesort')
    cutoff = float(coords[ordered[count - 1], 1])
    fig, ax = plt.subplots(figsize=(4.4, 3.15))
    fig.subplots_adjust(left=0.19, right=0.97, bottom=0.20, top=0.96)
    point_count = len(coords)
    if point_count >= 12000:
        marker_size, alpha_val = 3.4, 0.20
    elif point_count >= 6000:
        marker_size, alpha_val = 4.4, 0.26
    elif point_count >= 2500:
        marker_size, alpha_val = 5.4, 0.34
    else:
        marker_size, alpha_val = 7.0, 0.48
    ax.scatter(coords[:, 0], coords[:, 1], s=marker_size, alpha=alpha_val,
               color=FIGURE2_COLORS[method], marker='o', linewidths=0, edgecolors='none',
               rasterized=(fmt.lower() == 'pdf' and len(coords) > 4000))
    ax.axhline(cutoff, linestyle='--', color='#374151', linewidth=1.15, zorder=4)
    ax.set_xlabel('PA score' if method == 'pa' else 'LP score', fontsize=10)
    ax.set_ylabel('Isolation Forest score', fontsize=10)
    ax.tick_params(labelsize=8.5)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(False)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=5))
    ax.yaxis.set_major_locator(MaxNLocator(nbins=5))
    ax.ticklabel_format(axis='x', style='sci', scilimits=(-3, 4), useMathText=True)
    # No point categories, legend, panel letters, row/column names or title:
    # manuscript layout supplies the latter labels.
    return _finalize(fig, fmt)


def render_ccdf(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Distribution comparison')
    series = payload.get('series', [])
    x_label = payload.get('x_label', 'x')
    y_label = payload.get('y_label', 'P(X ≥ x)')
    fig, ax = plt.subplots(figsize=(6.8, 5.0))
    _apply_title(fig, title, payload.get('subtitle'))
    # top=0.88 ensures the legend (at bbox y=1.07) fits within the figure
    _reserve_paper_margins(fig, top=0.88, bottom=0.15, left=0.12, right=0.98)
    for i, spec in enumerate(series):
        points = spec.get('points', [])
        x = np.array([_safe_float(p.get('x'), np.nan) for p in points], dtype=float)
        y = np.array([_safe_float(p.get('y'), np.nan) for p in points], dtype=float)
        mask = np.isfinite(x) & np.isfinite(y) & (x > 0) & (y > 0)
        x = x[mask]
        y = y[mask]
        if len(x) == 0:
            continue
        label = spec.get('label', spec.get('id', f'Series {i+1}'))
        is_original = 'original' in str(label).lower()
        color = '#111827' if is_original else spec.get('color', PALETTE[i % len(PALETTE)])
        linestyle = '-' if is_original else spec.get('linestyle', LINESTYLES[(i+1) % len(LINESTYLES)])
        ax.step(x, y, where='post', label=label, color=color, linewidth=2.3 if is_original or spec.get('emphasis') else 1.6, linestyle=linestyle, zorder=3)
        if len(x) <= 30:
            ax.plot(x, y, linestyle='None', marker='o', markersize=2.4, color=color, alpha=0.8, zorder=4)
    if payload.get('log_x', True):
        ax.set_xscale('log')
    if payload.get('log_y', True):
        ax.set_yscale('log')
    _style_axes(ax, x_label=x_label, y_label=y_label, grid_axis='both')
    ax.grid(True, which='major', axis='both', color=GRID, linestyle=':', linewidth=0.8)
    ax.grid(True, which='minor', axis='both', color='#F1F5F9', linestyle=':', linewidth=0.5)
    _legend_above(ax, ncol=min(max(len(series), 1), 3), y=1.07)
    return _finalize(fig, fmt)


def _luminance(rgb):
    r, g, b = rgb[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _draw_graph(
    ax,
    graph_data: dict[str, Any],
    title: str,
    highlight_edges: set[str] | None = None,
    accent_color: str = '#0F766E',
    positions: dict | None = None,
    show_labels: bool = True,
    edge_style_mode: str = 'default',
):
    g = _build_graph(graph_data)
    if positions is None:
        positions = _positions_from_graph_data(graph_data) or _compute_layout(g)
    degrees = dict(g.degree())
    weights = [g[u][v].get('weight', 1.0) for u, v in g.edges()] or [1.0]
    max_w = max(weights)
    max_deg = max(degrees.values() or [1])
    large_graph = g.number_of_edges() > 2500 or g.number_of_nodes() > 1200

    if large_graph:
        node_sizes = [3 + 22 * math.sqrt(max(degrees.get(n, 1), 1) / max(max_deg, 1)) for n in g.nodes()]
    else:
        node_sizes = [180 + 520 * math.sqrt(max(degrees.get(n, 1), 1) / max(max_deg, 1)) for n in g.nodes()]
    node_colors = [degrees.get(n, 0) for n in g.nodes()]

    normal_edges = []
    low_edges = []
    high_edges = []
    if_edges = []
    highlighted = []
    edge_lookup = set(highlight_edges or [])

    def edge_keys(u: str, v: str):
        if u < v:
            return {f'{u}--{v}', f'{u}|{v}'}
        return {f'{v}--{u}', f'{v}|{u}'}

    for u, v in g.edges():
        attrs = g[u][v]
        # Use truthiness checks instead of `is True` to handle both
        # Python bool and integer 1/0 (which can arrive from JSON payloads).
        if edge_style_mode == 'score_extremes':
            if attrs.get('score_region') == 'low' or attrs.get('is_low_score'):
                low_edges.append((u, v))
            elif attrs.get('score_region') == 'high' or attrs.get('is_high_score'):
                high_edges.append((u, v))
            else:
                normal_edges.append((u, v))
        elif edge_style_mode == 'if_backbone':
            if attrs.get('is_if_backbone'):
                if_edges.append((u, v))
            else:
                normal_edges.append((u, v))
        elif edge_lookup and edge_keys(str(u), str(v)) & edge_lookup:
            highlighted.append((u, v))
        else:
            normal_edges.append((u, v))

    def widths(edgelist, base=0.35, span=1.5):
        return [base + span * (g[u][v].get('weight', 1.0) / max_w) for u, v in edgelist]

    def _set_zorder(artist, z):
        """NetworkX 3.6+ does not pass zorder to matplotlib collections;
        set it on the returned artist after drawing."""
        if artist is not None:
            try:
                artist.set_zorder(z)
            except Exception:
                pass

    # --- Draw edges (zorder=1 normal, zorder=2 highlighted, nodes on top at 3) ---
    if normal_edges:
        _set_zorder(nx.draw_networkx_edges(
            g,
            positions,
            edgelist=normal_edges,
            ax=ax,
            edge_color='#94A3B8' if edge_style_mode in {'score_extremes', 'if_backbone'} else '#8FB4AA',
            alpha=0.78 if edge_style_mode in {'score_extremes', 'if_backbone'} else 0.65,
            width=widths(normal_edges, base=0.22 if large_graph else 0.55, span=0.65 if large_graph else 1.8),
        ), 1)
    if low_edges:
        _set_zorder(nx.draw_networkx_edges(g, positions, edgelist=low_edges, ax=ax, edge_color='#2563EB', alpha=1.0, width=widths(low_edges, base=0.45 if large_graph else 0.70, span=1.15 if large_graph else 2.0)), 2)
    if high_edges:
        _set_zorder(nx.draw_networkx_edges(g, positions, edgelist=high_edges, ax=ax, edge_color='#DC2626', alpha=1.0, width=widths(high_edges, base=0.45 if large_graph else 0.70, span=1.15 if large_graph else 2.0)), 2)
    if if_edges:
        _set_zorder(nx.draw_networkx_edges(g, positions, edgelist=if_edges, ax=ax, edge_color='#7C3AED', alpha=1.0, width=widths(if_edges, base=0.50 if large_graph else 0.75, span=1.25 if large_graph else 2.2)), 2)
    if highlighted:
        _set_zorder(nx.draw_networkx_edges(
            g,
            positions,
            edgelist=highlighted,
            ax=ax,
            edge_color=accent_color,
            alpha=0.92,
            width=widths(highlighted, base=1.0, span=2.6),
        ), 2)

    # --- Draw nodes on top of all edges (zorder=3) ---
    nodes_artist = nx.draw_networkx_nodes(
        g,
        positions,
        ax=ax,
        node_size=node_sizes,
        node_color=node_colors,
        cmap=plt.cm.Blues,
        edgecolors='#1E3A8A',
        linewidths=0.15 if large_graph else 0.9,
        alpha=0.70 if large_graph else 0.86,
    )
    _set_zorder(nodes_artist, 3)

    if show_labels and not large_graph:
        cmap = plt.cm.Blues
        norm = plt.Normalize(vmin=min(node_colors or [0]), vmax=max(node_colors or [1]))
        texts = {}
        for node in g.nodes():
            rgba = cmap(norm(degrees.get(node, 0)))
            color = '#FFFFFF' if _luminance(rgba) < 0.55 else '#0F172A'
            size = degrees.get(node, 0)
            font_size = float(np.interp(size, [min(node_colors or [0]), max(node_colors or [1]) or 1], [6.8, 10.5]))
            texts[node] = ax.text(
                positions[node][0],
                positions[node][1],
                str(node),
                ha='center',
                va='center',
                fontsize=font_size,
                fontweight='bold',
                color=color,
                zorder=5,
            )
            texts[node].set_path_effects([pe.withStroke(linewidth=1.2, foreground='white' if color != '#FFFFFF' else '#1E3A8A')])

    xs = [p[0] for p in positions.values()] if positions else [0]
    ys = [p[1] for p in positions.values()] if positions else [0]
    if xs and ys:
        xmin, xmax = min(xs), max(xs)
        ymin, ymax = min(ys), max(ys)
        xpad = max((xmax - xmin) * 0.08, 0.08)
        ypad = max((ymax - ymin) * 0.08, 0.08)
        ax.set_xlim(xmin - xpad, xmax + xpad)
        ax.set_ylim(ymin - ypad, ymax + ypad)
    ax.set_aspect('equal')
    ax.set_axis_off()

    if edge_style_mode == 'score_extremes':
        ax.legend(
            handles=[
                Patch(facecolor='#94A3B8', edgecolor='#64748B', linewidth=0.5, label='Non-backbone edges'),
                Patch(facecolor='#2563EB', edgecolor='#1E40AF', linewidth=0.5, label='Lowest 20% score'),
                Patch(facecolor='#DC2626', edgecolor='#991B1B', linewidth=0.5, label='Highest 20% score'),
            ],
            loc='lower center',
            bbox_to_anchor=(0.5, -0.02),
            ncol=3,
            frameon=False,
        )
    elif edge_style_mode == 'if_backbone':
        ax.legend(
            handles=[
                Patch(facecolor='#94A3B8', edgecolor='#64748B', linewidth=0.5, label='Non-backbone edges'),
                Patch(facecolor='#7C3AED', edgecolor='#5B21B6', linewidth=0.5, label='Isolation Forest backbone'),
            ],
            loc='lower center',
            bbox_to_anchor=(0.5, -0.02),
            ncol=2,
            frameon=False,
        )
    return nodes_artist

def render_graph(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Graph')
    graph_data = payload.get('graph', payload)
    accent = payload.get('accent_color', '#0F766E')
    highlight_edges = set(payload.get('highlight_edges', []) or [])
    fig, ax = plt.subplots(figsize=(16.0, 10.0) if payload.get('large_figure', False) else (6.8, 5.6))
    _apply_title(fig, title, payload.get('subtitle'))
    # Keep generous margins for graph to ensure title and edge-style legends are visible
    _reserve_paper_margins(fig, top=0.92, bottom=0.06 if payload.get('edge_style_mode') else 0.03, left=0.02, right=0.98)
    nodes_artist = _draw_graph(ax, graph_data, title=title, highlight_edges=highlight_edges, accent_color=accent, show_labels=payload.get('show_labels', True), edge_style_mode=payload.get('edge_style_mode', 'default'))
    if payload.get('show_colorbar', False):
        cbar = fig.colorbar(nodes_artist, ax=ax, fraction=0.03, pad=0.012)
        cbar.set_label('Node degree', fontsize=8.5)
        cbar.ax.tick_params(labelsize=8)
    return _finalize(fig, fmt)


def render_graph_compare(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    left = payload['left']
    right = payload['right']
    left_graph = _build_graph(left.get('graph', left))
    right_graph = _build_graph(right.get('graph', right))
    union = nx.compose(left_graph, right_graph)
    positions = _compute_layout(union)
    fig, axes = plt.subplots(1, 2, figsize=(10.8, 5.8))
    bottom_margin = 0.08 if (left.get('edge_style_mode') or right.get('edge_style_mode')) else 0.05
    _reserve_paper_margins(fig, top=0.90, bottom=bottom_margin, left=0.03, right=0.97)
    n1 = _draw_graph(axes[0], left.get('graph', left), title=left.get('title', 'Left'), highlight_edges=set(left.get('highlight_edges', []) or []), accent_color=left.get('accent_color', '#0F766E'), positions=positions, show_labels=left.get('show_labels', True), edge_style_mode=left.get('edge_style_mode', 'default'))
    n2 = _draw_graph(axes[1], right.get('graph', right), title=right.get('title', 'Right'), highlight_edges=set(right.get('highlight_edges', []) or []), accent_color=right.get('accent_color', '#4338CA'), positions=positions, show_labels=right.get('show_labels', True), edge_style_mode=right.get('edge_style_mode', 'default'))
    if payload.get('title'):
        _apply_title(fig, payload['title'], payload.get('subtitle'))
    if payload.get('show_colorbar', False):
        cbar = fig.colorbar(n2, ax=axes.ravel().tolist(), fraction=0.022, pad=0.015)
        cbar.set_label('Node degree', fontsize=8.5)
        cbar.ax.tick_params(labelsize=8)
    return _finalize(fig, fmt)


def render_table(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Table')
    rows = payload.get('rows', [])
    columns = payload.get('columns', [])
    if isinstance(columns, list) and columns and isinstance(columns[0], str):
        col_keys = columns
        col_labels = columns
    else:
        col_keys = [c['key'] for c in columns] if columns else []
        col_labels = [c.get('label', c['key']) for c in columns] if columns else []
    if not col_keys and rows:
        col_keys = list(rows[0].keys())
        col_labels = col_keys

    wrapped_labels = [_wrap(label, 18) for label in col_labels]
    data = [[_wrap(row.get(k, '—'), 22) for k in col_keys] for row in rows]

    ncols = max(len(col_keys), 1)
    nrows = max(len(data), 1)
    fig_h = min(13.5, 1.5 + 0.40 * nrows)
    fig_w = max(8.5, min(18.0, 1.25 + 1.45 * ncols))
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    _apply_title(fig, title, payload.get('subtitle'))
    _reserve_paper_margins(fig, top=0.93, bottom=0.04, left=0.03, right=0.97)
    ax.axis('off')

    table = ax.table(cellText=data, colLabels=wrapped_labels, loc='center', cellLoc='left', colLoc='left')
    table.auto_set_font_size(False)
    table.set_fontsize(8.0)
    table.scale(1.00, 1.35)

    # set widths based on content length
    lengths = [max([len(str(col_labels[i]))] + [len(str(row.get(col_keys[i], '—'))) for row in rows]) for i in range(len(col_keys))] if col_keys else [1]
    total_len = float(sum(max(l, 6) for l in lengths))
    for (row_idx, col_idx), cell in table.get_celld().items():
        cell.set_edgecolor('#CBD5E1')
        if row_idx == 0:
            cell.visible_edges = 'TB'
            cell.set_linewidth(0.9)
            cell.set_facecolor('white')
            cell.set_text_props(weight='bold', color='#111827', wrap=True)
            cell.set_height(cell.get_height() * 1.15)
        else:
            cell.visible_edges = 'B'
            cell.set_linewidth(0.45)
            cell.set_facecolor('white')
            cell.set_text_props(color='#111827', wrap=True)
        if col_idx < len(lengths):
            frac = max(lengths[col_idx], 6) / total_len
            cell.set_width(frac * 0.98)
    return _finalize(fig, fmt)


def render_radar(payload: dict[str, Any], fmt: str) -> bytes:
    _apply_style()
    title = payload.get('title', 'Radar chart')
    categories = payload.get('categories', [])
    series = payload.get('series', [])
    if not categories:
        raise ValueError('Radar export requires categories.')
    angles = np.linspace(0, 2 * np.pi, len(categories), endpoint=False).tolist()
    angles += angles[:1]
    fig, ax = plt.subplots(figsize=(6.4, 6.2), subplot_kw=dict(polar=True))
    _apply_title(fig, title, payload.get('subtitle'))
    # top=0.88 ensures the legend (at bbox y=1.10) fits within the figure
    _reserve_paper_margins(fig, top=0.88, bottom=0.06, left=0.05, right=0.95)
    for i, spec in enumerate(series):
        values = [_safe_float(v) for v in spec.get('values', [])]
        values += values[:1]
        color = spec.get('color', PALETTE[i % len(PALETTE)])
        ax.plot(angles, values, linewidth=2.2, color=color, label=spec.get('label', f'Series {i+1}'))
        ax.fill(angles, values, color=color, alpha=0.12)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels([_wrap(c, 14) for c in categories])
    ax.set_yticks([0.25, 0.5, 0.75, 1.0])
    ax.set_yticklabels(['0.25', '0.50', '0.75', '1.00'])
    ax.set_ylim(0, 1)
    ax.grid(color=GRID, linestyle=':', linewidth=0.8)
    ax.legend(loc='upper center', bbox_to_anchor=(0.5, 1.10), ncol=min(len(series), 3), frameon=False)
    return _finalize(fig, fmt)


RENDERERS = {
    'histogram': render_histogram,
    'bar': render_bar,
    'line': render_line,
    'scatter': render_scatter,
    'single_score_iforest': render_single_score_iforest,
    'paper_score_scatter': render_paper_score_scatter,
    'ccdf': render_ccdf,
    'graph': render_graph,
    'graph_compare': render_graph_compare,
    'table': render_table,
    'radar': render_radar,
}


def render_figure(figure_type: str, payload: dict[str, Any], fmt: str) -> bytes:
    if figure_type not in RENDERERS:
        raise ValueError(f'Unsupported figure type: {figure_type}')
    return RENDERERS[figure_type](payload, fmt)


def build_filename(filename: str | None, title: str | None, figure_type: str, fmt: str) -> str:
    base = filename or title or figure_type
    return f"{_slugify(base)}.{fmt.lower()}"
