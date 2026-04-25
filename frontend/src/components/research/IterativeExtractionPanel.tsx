import React, { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchScoreStatus, runIterativeExtractionExperiment, useDatasets } from '../../api/client'
import { Button, EmptyState, MethodBadge, StatCard } from '../ui'
import { useWorkflowStore } from '../../store/workflowStore'
import PaperExportButton from '../export/PaperExportButton'
import { METHOD_MAP } from '../../constants/methods'
import type {
  ContaminationScoreSource,
  Dataset,
  GraphData,
  IterativeExtractionResponse,
  IterativeMethodId,
  IterativeMethodResult,
  IterativeRegionRow,
  IterativeScatterPoint,
  IterativeFeatureHistogram,
  IterativeHistogramGroup,
  ScoreCacheStatusResponse,
} from '../../types'

type MethodTab = IterativeMethodId | 'compare_all'

type DatasetOption = {
  id: string
  label: string
  isCustom: boolean
}

const METHOD_OPTIONS: IterativeMethodId[] = ['pa', 'lp', 'pa_lp']
const SCORE_COLUMNS: Record<IterativeMethodId, string[]> = {
  pa: ['preferential_attachment_1'],
  lp: ['local_path_index_1'],
  pa_lp: ['preferential_attachment_1', 'local_path_index_1'],
}

const CATEGORY_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  common: { label: 'Common', color: '#6D28D9', bg: 'bg-violet-50 text-violet-700 border-violet-200' },
  one_shot_only: { label: 'One-shot only', color: '#2563EB', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
  iterative_only: { label: 'Iterative only', color: '#EA580C', bg: 'bg-orange-50 text-orange-700 border-orange-200' },
  not_selected: { label: 'Not selected', color: '#CBD5E1', bg: 'bg-slate-50 text-slate-500 border-slate-200' },
}

function pct(value: number | string | null | undefined) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${num.toFixed(num >= 10 ? 1 : 2)}%`
}

function num(value: number | string | null | undefined, digits = 3) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function intFmt(value: number | string | null | undefined) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function methodLabel(method: IterativeMethodId) {
  return METHOD_MAP[method]?.short ?? method.toUpperCase()
}

function datasetLabel(dataset: Dataset) {
  return dataset.filename.replace(/\.csv$/i, '').replace(/_/g, ' ')
}

function safeStagePercentInputs(target: number, count: number) {
  if (count <= 1) return [target]
  const base = Number((target / count).toFixed(2))
  const values = Array.from({ length: count }, () => base)
  values[count - 1] = Number((target - base * (count - 1)).toFixed(2))
  return values
}

function TableShell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-gray-100">{children}</div>
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-bold text-navy">{title}</h3>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
  )
}

function MetricTable({ result }: { result: IterativeMethodResult }) {
  const metricColumns = [
    ['final_edges', 'Final edges'],
    ['edge_fraction', 'Edge frac.'],
    ['node_fraction', 'Node frac.'],
    ['reachability', 'Reachability'],
    ['connected_components', 'Components'],
    ['avg_clustering', 'Clustering'],
    ['degree_ks', 'Degree KS'],
    ['weight_ks', 'Weight KS'],
  ]
  const exportRows = result.summary_rows.map((row) => ({
    extraction: row.extraction,
    target_percent: pct(row.target_percent),
    stages: row.stages,
    final_edges: intFmt(row.final_edges),
    edge_fraction: num(row.edge_fraction),
    node_fraction: num(row.node_fraction),
    reachability: num(row.reachability),
    connected_components: intFmt(row.connected_components),
    avg_clustering: num(row.avg_clustering),
    degree_ks: num(row.degree_ks),
    weight_ks: num(row.weight_ks),
  }))

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <PaperExportButton config={{ figureType: 'table', title: `${methodLabel(result.method_id)} iterative summary metrics`, filename: `${result.method_id}-iterative-summary-metrics`, payload: { title: `${methodLabel(result.method_id)} iterative summary metrics`, rows: exportRows, columns: ['extraction','target_percent','stages','final_edges','edge_fraction','node_fraction','reachability','connected_components','avg_clustering','degree_ks','weight_ks'] } }} />
      </div>
      <TableShell>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Extraction</th>
            <th className="px-4 py-3 text-left">Target</th>
            <th className="px-4 py-3 text-left">Stages</th>
            {metricColumns.map(([key, label]) => <th key={key} className="px-4 py-3 text-right">{label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {result.summary_rows.map((row) => (
            <tr key={row.extraction}>
              <td className="px-4 py-3 font-semibold text-navy">{row.extraction}</td>
              <td className="px-4 py-3 text-gray-600">{pct(row.target_percent)}</td>
              <td className="px-4 py-3 text-gray-600">{row.stages}</td>
              {metricColumns.map(([key]) => (
                <td key={key} className="px-4 py-3 text-right font-mono text-gray-700">
                  {key.includes('edges') || key.includes('components') ? intFmt(row[key]) : num(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
    </div>
  )
}

function StageDetailsTable({ result }: { result: IterativeMethodResult }) {
  const scoreColumns = result.features
  const exportRows = result.stages.map((stage) => {
    const base: Record<string, string | number> = {
      stage: stage.stage_index,
      input_table_size: intFmt(stage.input_table_size),
      selected_edges: intFmt(stage.selected_edges),
      stage_percent_from_original: pct(stage.stage_percent_from_original),
      cutoff_rank: intFmt(stage.cutoff_rank),
    }
    scoreColumns.forEach((column) => {
      const stats = stage.score_stats[column] ?? {}
      const label = column.includes('preferential') ? 'PA' : 'LP'
      base[`mean_${label}`] = num(stats.mean)
      base[`min_${label}`] = num(stats.min)
      base[`max_${label}`] = num(stats.max)
    })
    return base
  })
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <PaperExportButton config={{ figureType: 'table', title: `${methodLabel(result.method_id)} iterative stage details`, filename: `${result.method_id}-iterative-stage-details`, payload: { title: `${methodLabel(result.method_id)} iterative stage details`, rows: exportRows } }} />
      </div>
      <TableShell>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Stage</th>
            <th className="px-4 py-3 text-right">Input table</th>
            <th className="px-4 py-3 text-right">Selected</th>
            <th className="px-4 py-3 text-right">Stage %</th>
            <th className="px-4 py-3 text-right">Cutoff rank</th>
            {scoreColumns.map((column) => (
              <React.Fragment key={column}>
                <th className="px-4 py-3 text-right">Mean {column.includes('preferential') ? 'PA' : 'LP'}</th>
                <th className="px-4 py-3 text-right">Min</th>
                <th className="px-4 py-3 text-right">Max</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {result.stages.map((stage) => (
            <tr key={stage.stage_index}>
              <td className="px-4 py-3 font-semibold text-navy">
                Stage {stage.stage_index}
                {stage.auto_completion && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">auto-fill</span>}
              </td>
              <td className="px-4 py-3 text-right font-mono">{intFmt(stage.input_table_size)}</td>
              <td className="px-4 py-3 text-right font-mono">{intFmt(stage.selected_edges)}</td>
              <td className="px-4 py-3 text-right font-mono">{pct(stage.stage_percent_from_original)}</td>
              <td className="px-4 py-3 text-right font-mono">{intFmt(stage.cutoff_rank)}</td>
              {scoreColumns.map((column) => {
                const stats = stage.score_stats[column] ?? {}
                return (
                  <React.Fragment key={column}>
                    <td className="px-4 py-3 text-right font-mono">{num(stats.mean)}</td>
                    <td className="px-4 py-3 text-right font-mono">{num(stats.min)}</td>
                    <td className="px-4 py-3 text-right font-mono">{num(stats.max)}</td>
                  </React.Fragment>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
    </div>
  )
}

function OverlapCards({ result }: { result: IterativeMethodResult }) {
  const high = result.region_analysis.high_tail_domination
  return (
    <div className="grid md:grid-cols-4 gap-4">
      <StatCard label="Common edges" value={result.overlap.common} sub="Selected by both" />
      <StatCard label="Only one-shot" value={result.overlap.only_one_shot} sub="Lost by iterative" />
      <StatCard label="Only iterative" value={result.overlap.only_iterative} sub="New progressive edges" />
      <StatCard label="Jaccard overlap" value={num(result.overlap.jaccard, 3)} sub="Same-size backbone similarity" />
      <div className="md:col-span-4 rounded-2xl border border-gray-100 bg-gradient-to-r from-slate-50 to-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-navy">Score-tail domination lens</div>
            <p className="text-xs text-gray-500 mt-1">
              Region: <span className="font-semibold">{String(high.region ?? 'high')}</span>. Negative delta means iterative selection is less dominated by the strongest tail.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
              <div className="text-[11px] text-gray-500">One-shot tail share</div>
              <div className="font-bold text-blue-700">{pct(high.one_shot_pct_of_selected)}</div>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
              <div className="text-[11px] text-gray-500">Iterative tail share</div>
              <div className="font-bold text-orange-700">{pct(high.iterative_pct_of_selected)}</div>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
              <div className="text-[11px] text-gray-500">Delta</div>
              <div className={`font-bold ${Number(high.delta_pct) <= 0 ? 'text-teal' : 'text-coral'}`}>{pct(high.delta_pct)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function RegionTable({ rows }: { rows: IterativeRegionRow[] }) {
  const stageKeys = Object.keys(rows[0] ?? {}).filter((key) => key.startsWith('stage_')).sort()
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <PaperExportButton config={{ figureType: 'table', title: 'Iterative region analysis', filename: 'iterative-region-analysis', payload: { title: 'Iterative region analysis', rows: rows.map((row) => ({ ...row })) } }} />
      </div>
      <TableShell>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Region</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3 text-right">One-shot</th>
            <th className="px-4 py-3 text-right">Iterative</th>
            <th className="px-4 py-3 text-right">Common</th>
            <th className="px-4 py-3 text-right">Only one-shot</th>
            <th className="px-4 py-3 text-right">Only iterative</th>
            {stageKeys.map((key) => <th key={key} className="px-4 py-3 text-right">{key.replace('_', ' ')}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row) => (
            <tr key={row.region}>
              <td className="px-4 py-3 font-semibold text-navy capitalize">{row.region.replace('/', ' / ')}</td>
              <td className="px-4 py-3 text-right font-mono">{intFmt(row.total_edges)}</td>
              <td className="px-4 py-3 text-right font-mono text-blue-700">{intFmt(row.one_shot_selected)}</td>
              <td className="px-4 py-3 text-right font-mono text-orange-700">{intFmt(row.iterative_selected)}</td>
              <td className="px-4 py-3 text-right font-mono text-violet-700">{intFmt(row.common)}</td>
              <td className="px-4 py-3 text-right font-mono">{intFmt(row.one_shot_only)}</td>
              <td className="px-4 py-3 text-right font-mono">{intFmt(row.iterative_only)}</td>
              {stageKeys.map((key) => <td key={key} className="px-4 py-3 text-right font-mono">{intFmt(row[key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
    </div>
  )
}

function RegionCircleLens({ rows, methodId }: { rows: IterativeRegionRow[]; methodId: IterativeMethodId }) {
  const displayRows = methodId === 'pa_lp'
    ? rows.filter((row) => ['high/high', 'high/low', 'low/high', 'low/low', 'middle/middle'].includes(row.region))
    : rows
  const palette = ['#EDE9FE', '#DCFCE7', '#FFEDD5', '#DBEAFE', '#FEE2E2']
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-navy">Region circle lens</div>
          <div className="text-xs text-gray-500 mt-1">Each circle is a score region. The numbers show how iterative selection differs from one-shot inside that region.</div>
        </div>
        <div className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-[11px] text-gray-500">Original graph regions</div>
      </div>
      <div className="grid sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {displayRows.map((row, index) => (
          <div key={row.region} className="relative min-h-[180px] rounded-2xl bg-slate-50 border border-gray-100 p-4 overflow-hidden">
            <div
              className="absolute -right-8 -bottom-10 h-36 w-36 rounded-full opacity-90 border border-white"
              style={{ backgroundColor: palette[index % palette.length] }}
            />
            <div className="relative">
              <div className="text-sm font-bold text-navy capitalize">{row.region.replace('/', ' / ')}</div>
              <div className="text-xs text-gray-500">{intFmt(row.total_edges)} total edges</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-white/90 border border-white px-3 py-2">
                  <div className="text-gray-500">One-shot</div>
                  <div className="font-bold text-blue-700">{intFmt(row.one_shot_selected)}</div>
                </div>
                <div className="rounded-xl bg-white/90 border border-white px-3 py-2">
                  <div className="text-gray-500">Iterative</div>
                  <div className="font-bold text-orange-700">{intFmt(row.iterative_selected)}</div>
                </div>
                <div className="rounded-xl bg-white/90 border border-white px-3 py-2">
                  <div className="text-gray-500">New</div>
                  <div className="font-bold text-teal">{intFmt(row.iterative_only)}</div>
                </div>
                <div className="rounded-xl bg-white/90 border border-white px-3 py-2">
                  <div className="text-gray-500">Common</div>
                  <div className="font-bold text-violet-700">{intFmt(row.common)}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


function HistogramCard({ histogram, accent = '#4F46E5', xLabel = 'raw score', exportTitle }: { histogram: IterativeFeatureHistogram; accent?: string; xLabel?: string; exportTitle?: string }) {
  const chartData = (histogram.bins ?? []).map((bin) => {
    const allCount = Number(bin.all_count) || 0
    const anomalies = Number(bin.selected_count) || 0
    const normal = Math.max(0, allCount - anomalies)
    const start = Number(bin.start)
    const end = Number(bin.end)
    const center = Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : bin.bin_index
    return {
      ...bin,
      bin_center: center,
      normal,
      anomalies,
    }
  })

  const selected = chartData.reduce((sum, b) => sum + Number(b.anomalies || 0), 0)
  const normal = chartData.reduce((sum, b) => sum + Number(b.normal || 0), 0)

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-navy">{histogram.label} histogram</div>
          <div className="text-xs text-gray-500 mt-1">
            Gray = normal edges, colored = selected backbone/anomaly edges.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-semibold text-gray-600 border border-gray-100">
            {intFmt(selected)} selected · {intFmt(normal)} normal
          </div>
          <PaperExportButton config={{ figureType: 'histogram', title: exportTitle ?? `${histogram.label} histogram`, filename: (exportTitle ?? `${histogram.label} histogram`).toLowerCase().replace(/[^a-z0-9]+/g, '-'), payload: { title: exportTitle ?? `${histogram.label} histogram`, x_label: xLabel, y_label: 'Edge count', bins: chartData.map((bin) => ({ bin_center: bin.bin_center, anomalies: bin.anomalies, normal: bin.normal, count: Number(bin.normal) + Number(bin.anomalies) })), accent_color: accent, anomaly_label: 'Selected', normal_label: 'Normal' } }} />
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 12, right: 16, left: 4, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#D8DEE8" />
          <XAxis
            dataKey="bin_center"
            tickFormatter={(v) => Number(v).toFixed(2)}
            tick={{ fontSize: 11, fill: '#64748B' }}
            label={{ value: xLabel, position: 'insideBottom', offset: -8, fontSize: 11, fill: '#64748B' }}
          />
          <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
          <Tooltip
            cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
            contentStyle={{ borderRadius: 10, borderColor: '#E5E7EB', boxShadow: '0 10px 30px rgba(15,23,42,.12)' }}
            labelFormatter={(v) => `Bin center ≈ ${Number(v).toFixed(4)}`}
            formatter={(val, name) => [
              val,
              name === 'anomalies' ? 'Anomaly edges' : 'Normal edges',
            ]}
          />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{ paddingTop: 8 }}
            formatter={(value) => value === 'anomalies' ? 'anomalies' : 'normal'}
          />
          <Bar dataKey="normal" stackId="score" fill="#D1D5DB" name="normal" />
          <Bar dataKey="anomalies" stackId="score" fill={accent} name="anomalies" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function HistogramGroupView({ group, accent }: { group: IterativeHistogramGroup; accent: string }) {
  const cards = [
    ...(group.histograms ?? []).map((histogram) => ({ histogram, xLabel: 'raw score', accent })),
    ...(group.model_output_histogram ? [{ histogram: group.model_output_histogram, xLabel: 'score_samples', accent: '#4338CA' }] : []),
  ]
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-navy">{group.label}</div>
          <div className="text-xs text-gray-500 mt-1">
            Input table: {intFmt(group.input_table_size)} edges · selected overlay: {intFmt(group.selected_edges)} edges
            {group.stage_percent_from_original !== undefined ? ` · stage target ${pct(group.stage_percent_from_original)}` : ''}
          </div>
        </div>
        {group.stage_index && <span className="rounded-full bg-orange-50 px-3 py-1 text-[11px] font-semibold text-orange-700 border border-orange-200">Stage {group.stage_index}</span>}
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        {cards.map(({ histogram, xLabel, accent: cardAccent }) => (
          <HistogramCard key={`${group.label}-${histogram.feature}`} histogram={histogram} accent={cardAccent} xLabel={xLabel} exportTitle={`${group.label} — ${histogram.label} histogram`} />
        ))}
      </div>
    </div>
  )
}

function ScoreHistogramPanel({ result }: { result: IterativeMethodResult }) {
  const hist = result.score_histograms
  if (!hist) return null
  return (
    <div className="space-y-5">
      <HistogramGroupView group={hist.one_shot} accent="#2563EB" />
      <div className="grid gap-5">
        {hist.stages.map((stage, index) => (
          <HistogramGroupView key={stage.stage_index ?? index} group={stage} accent={['#EA580C', '#D97706', '#059669', '#7C3AED'][index % 4]} />
        ))}
      </div>
    </div>
  )
}

function RankScatter({ result }: { result: IterativeMethodResult }) {
  const points = result.rank_scatter.points
  const selected = points.filter((p) => p.selection_category !== 'not_selected')
  const domain = useMemo(() => {
    const xs = points.map((p) => Number(p.score)).filter(Number.isFinite)
    const ys = points.map((p) => Number(p.one_shot_rank)).filter(Number.isFinite)
    const minX = Math.min(...xs, 0)
    const maxX = Math.max(...xs, 1)
    return {
      minX,
      maxX,
      minY: Math.min(...ys, 1),
      maxY: Math.max(...ys, 1),
    }
  }, [points])

  const width = 980
  const height = 460
  const padLeft = 72
  const padRight = 30
  const padTop = 54
  const padBottom = 58
  const projectX = (value: number) => padLeft + ((value - domain.minX) / (domain.maxX - domain.minX || 1)) * (width - padLeft - padRight)
  const projectY = (rank: number) => padTop + ((rank - domain.minY) / (domain.maxY - domain.minY || 1)) * (height - padTop - padBottom)
  const thresholds = result.rank_scatter.thresholds ?? {}
  const low = Number(thresholds.low_threshold ?? thresholds.p10)
  const median = Number(thresholds.median ?? thresholds.p50)
  const high = Number(thresholds.high_threshold ?? thresholds.p90)
  const regionConfig = result.region_config ?? { low_percent: 10, high_percent: 10, middle_percent: 80 }

  const pointColor = (p: IterativeScatterPoint) => {
    if (p.selection_category === 'common') return '#7C3AED'
    if (p.selection_category === 'one_shot_only') return '#2563EB'
    if (p.selection_category === 'iterative_only') {
      const stageColors = ['#EA580C', '#D97706', '#059669', '#DC2626', '#0891B2', '#7C3AED']
      return stageColors[((Number(p.stage) || 1) - 1) % stageColors.length]
    }
    return CATEGORY_STYLE.not_selected.color
  }

  const xTicks = [domain.minX, low, median, high, domain.maxX].filter((v, i, arr) => Number.isFinite(v) && arr.findIndex((x) => Math.abs(Number(x) - Number(v)) < 1e-9) === i).map(Number)
  const yTicks = [domain.minY, Math.round(domain.maxY * 0.25), Math.round(domain.maxY * 0.5), Math.round(domain.maxY * 0.75), domain.maxY].filter((v, i, arr) => Number.isFinite(v) && arr.indexOf(v) === i)
  const bgBands = [
    Number.isFinite(low) ? { x1: domain.minX, x2: low, fill: '#EFF6FF', label: `Low ${pct(regionConfig.low_percent)}` } : null,
    Number.isFinite(low) && Number.isFinite(high) ? { x1: low, x2: high, fill: '#F8FAFC', label: `Middle ${pct(regionConfig.middle_percent)}` } : null,
    Number.isFinite(high) ? { x1: high, x2: domain.maxX, fill: '#FFF7ED', label: `High ${pct(regionConfig.high_percent)}` } : null,
  ].filter(Boolean) as { x1: number; x2: number; fill: string; label: string }[]

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-sm font-bold text-navy">{methodLabel(result.method_id)} score vs anomaly rank</div>
          <div className="text-xs text-gray-500 mt-1">
            x-axis = raw method score, y-axis = one-shot Isolation Forest rank. Rank 1 is the most anomalous. Vertical bands use your low/high region settings.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <PaperExportButton config={{ figureType: 'scatter', title: `${methodLabel(result.method_id)} score vs anomaly rank`, filename: `${result.method_id}-score-vs-anomaly-rank`, payload: { title: `${methodLabel(result.method_id)} score vs anomaly rank`, x_key: 'score', y_key: 'one_shot_rank', x_label: result.rank_scatter.x_axis, y_label: 'Anomaly rank', group_key: 'selection_category', rows: points.map((p) => ({ score: Number(p.score), one_shot_rank: Number(p.one_shot_rank), selection_category: p.selection_category })), groups: [
            { value: 'common', label: 'Common', color: '#7C3AED' },
            { value: 'one_shot_only', label: 'One-shot only', color: '#2563EB' },
            { value: 'iterative_only', label: 'Iterative only', color: '#EA580C' },
            { value: 'not_selected', label: 'Not selected', color: '#CBD5E1' },
          ], vline_x: Number.isFinite(low) ? low : undefined } }} />
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700">Common</span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">One-shot only</span>
          <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700">Iterative stage</span>
        </div>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[460px] w-full">
          {bgBands.map((band) => {
            const x1 = Math.max(padLeft, projectX(band.x1))
            const x2 = Math.min(width - padRight, projectX(band.x2))
            if (x2 <= x1) return null
            return <g key={band.label}>
              <rect x={x1} y={padTop} width={x2 - x1} height={height - padTop - padBottom} fill={band.fill} opacity={0.78} />
              <text x={(x1 + x2) / 2} y={padTop - 16} textAnchor="middle" fontSize="11" fill="#64748B">{band.label}</text>
            </g>
          })}
          {xTicks.map((tick) => <g key={`x-${tick}`}>
            <line x1={projectX(tick)} y1={padTop} x2={projectX(tick)} y2={height - padBottom} stroke="#CBD5E1" strokeDasharray={tick === median ? '7 5' : '3 5'} />
            <text x={projectX(tick)} y={height - padBottom + 18} textAnchor="middle" fontSize="10" fill="#64748B">{tick.toFixed(tick >= 100 ? 0 : 2)}</text>
          </g>)}
          {yTicks.map((tick) => <g key={`y-${tick}`}>
            <line x1={padLeft} y1={projectY(Number(tick))} x2={width - padRight} y2={projectY(Number(tick))} stroke="#E5E7EB" />
            <text x={padLeft - 10} y={projectY(Number(tick)) + 4} textAnchor="end" fontSize="10" fill="#64748B">#{intFmt(tick)}</text>
          </g>)}
          <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} stroke="#94A3B8" />
          <line x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} stroke="#94A3B8" />
          <text x={width / 2} y={height - 12} textAnchor="middle" fontSize="12" fill="#64748B">{result.rank_scatter.x_axis}</text>
          <text transform={`translate(22 ${height / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#64748B">Anomaly rank</text>
          <text x={padLeft} y={34} fontSize="11" fill="#64748B">Most anomalous</text>
          {points.filter((p) => p.selection_category === 'not_selected').map((p) => (
            <circle key={p.edge_key} cx={projectX(Number(p.score))} cy={projectY(Number(p.one_shot_rank))} r={2} fill={CATEGORY_STYLE.not_selected.color} opacity={0.32} />
          ))}
          {selected.map((p) => {
            const color = pointColor(p)
            const radius = p.selection_category === 'common' ? 5.4 : 4.8
            return (
              <circle key={p.edge_key} cx={projectX(Number(p.score))} cy={projectY(Number(p.one_shot_rank))} r={radius} fill={color} opacity={0.95} stroke="#fff" strokeWidth={1}>
                <title>{`${p.source} - ${p.target}
Score=${p.score}
One-shot rank=${p.one_shot_rank}
Stage=${p.stage ?? '—'}
Stage rank=${p.stage_rank ?? '—'}
Region=${p.region ?? '—'}
${CATEGORY_STYLE[p.selection_category]?.label ?? p.selection_category}`}</title>
              </circle>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function PaLpScatter({ result }: { result: IterativeMethodResult }) {
  const scatter = result.feature_scatter
  if (!scatter) return null
  const points = scatter.points
  const domain = useMemo(() => {
    const xs = points.map((p) => Number(p.pa)).filter(Number.isFinite)
    const ys = points.map((p) => Number(p.lp)).filter(Number.isFinite)
    return { minX: Math.min(...xs, 0), maxX: Math.max(...xs, 1), minY: Math.min(...ys, 0), maxY: Math.max(...ys, 1) }
  }, [points])
  const width = 920
  const height = 430
  const pad = 58
  const projectX = (value: number) => pad + ((value - domain.minX) / (domain.maxX - domain.minX || 1)) * (width - pad * 2)
  const projectY = (value: number) => height - (pad + ((value - domain.minY) / (domain.maxY - domain.minY || 1)) * (height - pad * 2))
  const paT = scatter.thresholds.pa ?? {}
  const lpT = scatter.thresholds.lp ?? {}
  const vLines = [paT.p10, paT.p50, paT.p90].filter((v: unknown) => Number.isFinite(Number(v))).map(Number)
  const hLines = [lpT.p10, lpT.p50, lpT.p90].filter((v: unknown) => Number.isFinite(Number(v))).map(Number)
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-4">
        <div className="text-sm font-bold text-navy">PA+LP joint score space</div>
        <div className="text-xs text-gray-500 mt-1">x-axis is raw PA, y-axis is raw LP. This reveals whether iterative PA+LP finds mixed-profile edges.</div>
      </div>
      <div className="rounded-xl border border-gray-100 bg-slate-50 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[430px] w-full">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const x = pad + (width - pad * 2) * ratio
            const y = pad + (height - pad * 2) * ratio
            return <g key={ratio}><line x1={x} y1={pad} x2={x} y2={height - pad} stroke="#E5E7EB" /><line x1={pad} y1={y} x2={width - pad} y2={y} stroke="#E5E7EB" /></g>
          })}
          {vLines.map((value, idx) => <line key={`v-${idx}`} x1={projectX(value)} y1={pad} x2={projectX(value)} y2={height - pad} stroke="#94A3B8" strokeDasharray={idx === 1 ? '8 6' : '3 5'} />)}
          {hLines.map((value, idx) => <line key={`h-${idx}`} x1={pad} y1={projectY(value)} x2={width - pad} y2={projectY(value)} stroke="#94A3B8" strokeDasharray={idx === 1 ? '8 6' : '3 5'} />)}
          <text x={width / 2} y={height - 12} textAnchor="middle" fontSize="12" fill="#64748B">Raw PA score</text>
          <text transform={`translate(18 ${height / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#64748B">Raw LP score</text>
          {points.map((p) => {
            const style = CATEGORY_STYLE[p.selection_category] ?? CATEGORY_STYLE.not_selected
            const selected = p.selection_category !== 'not_selected'
            return (
              <circle key={p.edge_key} cx={projectX(Number(p.pa))} cy={projectY(Number(p.lp))} r={selected ? 4.6 : 2.2} fill={style.color} opacity={selected ? 0.9 : 0.38} stroke={selected ? '#fff' : 'transparent'}>
                <title>{`${p.source} - ${p.target}\nPA=${p.pa}\nLP=${p.lp}\nStage=${p.stage ?? '—'}\nRegion=${p.region_3x3 ?? '—'}\n${style.label}`}</title>
              </circle>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function GraphCard({ graph, mode, title, subtitle, className = '' }: { graph: GraphData; mode: 'original' | 'one_shot' | 'iterative'; title: string; subtitle: string; className?: string }) {
  const nodes = graph.nodes ?? []
  const links = graph.links ?? []
  const domain = useMemo(() => {
    const xs = nodes.map((n) => Number(n.x ?? 0))
    const ys = nodes.map((n) => Number(n.y ?? 0))
    return { minX: Math.min(...xs, -1), maxX: Math.max(...xs, 1), minY: Math.min(...ys, -1), maxY: Math.max(...ys, 1) }
  }, [nodes])
  const width = 820
  const height = 540
  const pad = 54
  const nodeMap = new Map(nodes.map((n) => [String(n.id), n]))
  const x = (value: number) => pad + ((value - domain.minX) / (domain.maxX - domain.minX || 1)) * (width - pad * 2)
  const y = (value: number) => height - (pad + ((value - domain.minY) / (domain.maxY - domain.minY || 1)) * (height - pad * 2))

  const isKeptForMode = (cat: unknown) => {
    if (mode === 'original') return true
    if (mode === 'one_shot') return cat === 'common' || cat === 'one_shot_only'
    return cat === 'common' || cat === 'iterative_only'
  }

  const keptLinks = links.filter((link) => isKeptForMode(link.selection_category))
  const keptNodeIds = new Set<string>()
  keptLinks.forEach((link) => {
    const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
    const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
    keptNodeIds.add(sourceId)
    keptNodeIds.add(targetId)
  })

  const topDegreeNodes = new Set(
    [...nodes]
      .sort((a, b) => Number(b.degree ?? 0) - Number(a.degree ?? 0))
      .slice(0, 10)
      .map((n) => String(n.id)),
  )

  const edgeColor = (cat: unknown) => {
    if (mode === 'original') return '#2563EB'
    if (cat === 'common') return '#7C3AED'
    if (cat === 'one_shot_only') return '#2563EB'
    if (cat === 'iterative_only') return '#EA580C'
    return '#CBD5E1'
  }

  const nodeColor = (nodeId: string) => {
    if (mode === 'original') return '#2563EB'
    if (keptNodeIds.has(nodeId)) return mode === 'one_shot' ? '#5B4BA3' : '#EA580C'
    return '#CBD5E1'
  }

  const labelNodes = nodes.filter((node) => {
    const id = String(node.id)
    if (mode === 'original') return topDegreeNodes.has(id)
    return keptNodeIds.has(id) && (topDegreeNodes.has(id) || Number(node.degree ?? 0) >= 3)
  })

  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold text-navy">{title}</div>
          <div className="text-sm text-gray-500 mt-1">{subtitle}</div>
        </div>
        <div className="rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-100">
          {keptLinks.length} edges
        </div>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-slate-50 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[540px] w-full">
          {mode !== 'original' &&
            links.map((link, idx) => {
              const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
              const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
              const source = nodeMap.get(sourceId)
              const target = nodeMap.get(targetId)
              if (!source || !target) return null
              return <line key={`context-${link.edge_key ?? idx}`} x1={x(Number(source.x ?? 0))} y1={y(Number(source.y ?? 0))} x2={x(Number(target.x ?? 0))} y2={y(Number(target.y ?? 0))} stroke="#CBD5E1" strokeWidth={1} strokeOpacity={0.24} />
            })}

          {keptLinks.map((link, idx) => {
            const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
            const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
            const source = nodeMap.get(sourceId)
            const target = nodeMap.get(targetId)
            if (!source || !target) return null
            return <line key={`${mode}-${link.edge_key ?? idx}`} x1={x(Number(source.x ?? 0))} y1={y(Number(source.y ?? 0))} x2={x(Number(target.x ?? 0))} y2={y(Number(target.y ?? 0))} stroke={edgeColor(link.selection_category)} strokeWidth={mode === 'original' ? 2 : 3.1} strokeOpacity={mode === 'original' ? 0.82 : 0.92} strokeLinecap="round" />
          })}

          {nodes.map((node) => {
            const id = String(node.id)
            const kept = mode === 'original' || keptNodeIds.has(id)
            const radius = Math.max(4, Math.min(11, 3.6 + Math.sqrt(Number(node.degree || 1))))
            return (
              <circle key={node.id} cx={x(Number(node.x ?? 0))} cy={y(Number(node.y ?? 0))} r={radius} fill={nodeColor(id)} fillOpacity={kept ? 0.92 : 0.42} stroke="#fff" strokeWidth={kept ? 1.2 : 0.8}>
                <title>{`Node ${node.id}\nDegree ${node.degree}${kept && mode !== 'original' ? '\nIn backbone' : ''}`}</title>
              </circle>
            )
          })}

          {labelNodes.map((node) => {
            const px = x(Number(node.x ?? 0))
            const py = y(Number(node.y ?? 0))
            return (
              <g key={`label-${node.id}`}>
                <circle cx={px} cy={py} r={10} fill="rgba(255,255,255,0.88)" stroke="rgba(15,23,42,0.18)" />
                <text x={px} y={py + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1B2A4A">
                  {node.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function GraphOverlay({ graph }: { graph: GraphData }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-navy">Graph views</div>
          <div className="text-xs text-gray-500 mt-1">Large readable views: original graph, one-shot backbone, and iterative backbone. Backbone cards keep the original graph as a light gray context.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <PaperExportButton config={{ figureType: 'graph_compare', title: 'Iterative extraction graph views', filename: 'iterative-extraction-graph-views', payload: { title: 'Iterative extraction graph views', left: { title: 'Original graph', graph, accent_color: '#2563EB' }, right: { title: 'One-shot backbone overlay', graph, highlight_edges: (graph.links ?? []).filter((l: any) => l.selection_category === 'common' || l.selection_category === 'one_shot_only').map((l: any) => l.edge_key), accent_color: '#2563EB' } } }} />
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700">purple = common</span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">blue = one-shot only</span>
          <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700">orange = iterative only</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500">gray = original context</span>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <GraphCard graph={graph} mode="original" title="Original graph" subtitle="All original edges, shown larger for context." className="xl:col-span-2" />
        <GraphCard graph={graph} mode="one_shot" title="One-shot backbone" subtitle="Colored edges are kept by the one-shot extraction. Gray edges are the original context." />
        <GraphCard graph={graph} mode="iterative" title="Iterative backbone" subtitle="Colored edges are kept across iterative stages. Gray edges are the original context." />
      </div>
    </div>
  )
}

function EdgeInspector({ result }: { result: IterativeMethodResult }) {
  const rows = result.edge_inspector.slice(0, 140)
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <PaperExportButton config={{ figureType: 'table', title: `${methodLabel(result.method_id)} iterative edge inspector`, filename: `${result.method_id}-iterative-edge-inspector`, payload: { title: `${methodLabel(result.method_id)} iterative edge inspector`, rows } }} />
      </div>
      <TableShell>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Edge</th>
            <th className="px-4 py-3 text-left">Selection</th>
            <th className="px-4 py-3 text-right">Stage</th>
            <th className="px-4 py-3 text-right">One-shot rank</th>
            <th className="px-4 py-3 text-right">Stage rank</th>
            <th className="px-4 py-3 text-left">Region</th>
            {SCORE_COLUMNS[result.method_id].map((column) => <th key={column} className="px-4 py-3 text-right">{column.includes('preferential') ? 'PA' : 'LP'}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row) => {
            const style = CATEGORY_STYLE[row.selection_category] ?? CATEGORY_STYLE.not_selected
            return (
              <tr key={row.edge_key}>
                <td className="px-4 py-3 font-mono text-xs text-navy">{row.edge_key}</td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${style.bg}`}>{style.label}</span></td>
                <td className="px-4 py-3 text-right font-mono">{row.stage ? `S${row.stage}` : '—'}</td>
                <td className="px-4 py-3 text-right font-mono">{row.one_shot_rank ? `#${row.one_shot_rank}` : '—'}</td>
                <td className="px-4 py-3 text-right font-mono">{row.stage_rank ? `#${row.stage_rank}` : '—'}</td>
                <td className="px-4 py-3 capitalize">{String(row.region ?? '—').replace('/', ' / ')}</td>
                {SCORE_COLUMNS[result.method_id].map((column) => <td key={column} className="px-4 py-3 text-right font-mono">{num(row[column])}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableShell>
    </div>
  )
}

function MethodResultTab({ result }: { result: IterativeMethodResult }) {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-gray-100 bg-gradient-to-r from-white via-slate-50 to-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <MethodBadge id={result.method_id} />
              <h2 className="text-xl font-bold text-navy">{result.label}: one-shot vs iterative extraction</h2>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Same final target, different extraction logic. Iterative stages are measured from the original edge count, not from the remaining table.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
              <div className="text-[11px] text-gray-500">Target</div>
              <div className="text-lg font-bold text-navy">{pct(result.target_percent)}</div>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
              <div className="text-[11px] text-gray-500">Final edges</div>
              <div className="text-lg font-bold text-navy">{result.target_edges}</div>
            </div>
          </div>
        </div>
      </div>

      <section>
        <SectionTitle title="1. Main summary metrics" subtitle="Both rows have the same final edge target, so the structural comparison is fair." />
        <MetricTable result={result} />
      </section>

      <section>
        <SectionTitle title="2. Stage details" subtitle="Input table decreases after each stage, but every stage percentage is based on the original graph size." />
        <StageDetailsTable result={result} />
      </section>

      <section>
        <SectionTitle title="3. Overlay with one-shot" subtitle="This measures whether the iterative backbone copies one-shot or discovers new edges." />
        <OverlapCards result={result} />
      </section>

      <section className="space-y-4">
        <SectionTitle title="4. Region analysis" subtitle="High/middle/low score regions show where each stage is taking its edges from." />
        <RegionCircleLens rows={result.region_analysis.rows} methodId={result.method_id} />
        <RegionTable rows={result.region_analysis.rows} />
      </section>

      <section className="space-y-5">
        <SectionTitle title="5. Score distribution histograms" subtitle="For one-shot and for every iterative stage, the gray bars show the input score distribution and the colored overlay shows the edges selected at that pass." />
        <ScoreHistogramPanel result={result} />
      </section>

      <section className="space-y-5">
        <SectionTitle title="6. Scatter and graph visualizations" subtitle="The scatter plot uses the pure method score against Isolation Forest anomaly rank. For PA+LP, a second joint PA-LP plot is also shown." />
        <RankScatter result={result} />
        <PaLpScatter result={result} />
        <GraphOverlay graph={result.graph_overlay} />
      </section>

      <section>
        <SectionTitle title="7. Edge inspector" subtitle="Inspect common, one-shot-only, and iterative-only edges with their ranks, stages, and score regions." />
        <EdgeInspector result={result} />
      </section>

      <section>
        <div className="rounded-2xl border border-teal/20 bg-teal-bg/60 p-5">
          <div className="text-sm font-bold text-teal">Main interpretation</div>
          <p className="mt-2 text-sm leading-6 text-teal">{result.interpretation}</p>
        </div>
      </section>
    </div>
  )
}

function CompareAllTab({ response }: { response: IterativeExtractionResponse }) {
  const entries = response.compare_all.entries
  const keys = response.compare_all.jaccard_keys
  const matrix = response.compare_all.jaccard_matrix
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionTitle title="All selected methods: one-shot vs iterative" subtitle="Every selected method appears twice: normal one-shot and progressive iterative extraction." />
        <div className="flex justify-end">
          <PaperExportButton config={{ figureType: 'table', title: 'Iterative compare-all summary', filename: 'iterative-compare-all-summary', payload: { title: 'Iterative compare-all summary', rows: entries } }} />
        </div>
        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Method</th>
                <th className="px-4 py-3 text-left">Extraction</th>
                <th className="px-4 py-3 text-right">Edges</th>
                <th className="px-4 py-3 text-right">Edge frac.</th>
                <th className="px-4 py-3 text-right">Node frac.</th>
                <th className="px-4 py-3 text-right">Reachability</th>
                <th className="px-4 py-3 text-right">Components</th>
                <th className="px-4 py-3 text-right">Degree KS</th>
                <th className="px-4 py-3 text-right">Weight KS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {entries.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-3 font-semibold text-navy">{row.method}</td>
                  <td className="px-4 py-3">{row.extraction}</td>
                  <td className="px-4 py-3 text-right font-mono">{intFmt(row.final_edges)}</td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.edge_fraction)}</td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.node_fraction)}</td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.reachability)}</td>
                  <td className="px-4 py-3 text-right font-mono">{intFmt(row.connected_components)}</td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.degree_ks)}</td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.weight_ks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Jaccard overlap matrix" subtitle="Higher values mean two final backbones select similar edge sets." />
        <div className="flex justify-end">
          <PaperExportButton config={{ figureType: 'table', title: 'Iterative Jaccard overlap matrix', filename: 'iterative-jaccard-overlap-matrix', payload: { title: 'Iterative Jaccard overlap matrix', rows: matrix } }} />
        </div>
        <TableShell>
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left">Backbone</th>
                {keys.map((key) => <th key={key} className="px-3 py-3 text-right">{key.replace('_', ' ')}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {matrix.map((row) => (
                <tr key={row.key}>
                  <td className="px-3 py-3 font-semibold text-navy">{String(row.key).replace('_', ' ')}</td>
                  {keys.map((key) => <td key={key} className="px-3 py-3 text-right font-mono">{num(row[key], 3)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Tail-region summary" subtitle="A quick view of whether iterative extraction reduces or increases high-tail domination for each method." />
        <div className="flex justify-end">
          <PaperExportButton config={{ figureType: 'table', title: 'Iterative tail-region summary', filename: 'iterative-tail-region-summary', payload: { title: 'Iterative tail-region summary', rows: response.compare_all.region_summary } }} />
        </div>
        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Method</th>
                <th className="px-4 py-3 text-left">Tail region</th>
                <th className="px-4 py-3 text-right">One-shot tail %</th>
                <th className="px-4 py-3 text-right">Iterative tail %</th>
                <th className="px-4 py-3 text-right">Delta</th>
                <th className="px-4 py-3 text-right">Jaccard</th>
                <th className="px-4 py-3 text-right">Iterative-only edges</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {response.compare_all.region_summary.map((row) => (
                <tr key={row.method_id}>
                  <td className="px-4 py-3 font-semibold text-navy">{row.method}</td>
                  <td className="px-4 py-3 capitalize">{String(row.tail_region).replace('/', ' / ')}</td>
                  <td className="px-4 py-3 text-right font-mono text-blue-700">{pct(row.one_shot_tail_pct)}</td>
                  <td className="px-4 py-3 text-right font-mono text-orange-700">{pct(row.iterative_tail_pct)}</td>
                  <td className="px-4 py-3 text-right font-mono">{pct(row.delta_pct)}</td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.jaccard_with_one_shot, 3)}</td>
                  <td className="px-4 py-3 text-right font-mono">{intFmt(row.iterative_only_edges)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </section>

      <section>
        <div className="rounded-2xl border border-purple/20 bg-purple-bg/60 p-5">
          <div className="text-sm font-bold text-purple">Final comparison interpretation</div>
          <p className="mt-2 text-sm leading-6 text-purple">{response.compare_all.interpretation}</p>
        </div>
      </section>
    </div>
  )
}

export default function IterativeExtractionPanel() {
  const { sessionId, datasetId, isCustomDataset } = useWorkflowStore()
  const { data: datasets = [] } = useDatasets()
  const [selectedDataset, setSelectedDataset] = useState(datasetId ?? 'lesmis')
  const [selectedIsCustom, setSelectedIsCustom] = useState(isCustomDataset)
  const [scoreSource, setScoreSource] = useState<ContaminationScoreSource>('auto')
  const [cacheStatus, setCacheStatus] = useState<ScoreCacheStatusResponse | null>(null)
  const [methods, setMethods] = useState<IterativeMethodId[]>(['pa'])
  const [targetPercent, setTargetPercent] = useState(20)
  const [stageCount, setStageCount] = useState(2)
  const [stagePercents, setStagePercents] = useState<number[]>([10, 10])
  const [lowRegionPercent, setLowRegionPercent] = useState(10)
  const [highRegionPercent, setHighRegionPercent] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<IterativeExtractionResponse | null>(null)
  const [activeTab, setActiveTab] = useState<MethodTab>('pa')

  const datasetOptions: DatasetOption[] = useMemo(() => {
    const base = datasets.map((d: Dataset) => ({ id: d.id, label: datasetLabel(d), isCustom: false }))
    if (datasetId && isCustomDataset) base.unshift({ id: datasetId, label: `Uploaded: ${datasetId}`, isCustom: true })
    return base
  }, [datasets, datasetId, isCustomDataset])

  const stageSum = stagePercents.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0)
  const stageSumValid = Math.abs(stageSum - targetPercent) <= 0.01
  const regionSumValid = lowRegionPercent >= 0 && highRegionPercent >= 0 && lowRegionPercent + highRegionPercent <= 100

  useEffect(() => {
    let cancelled = false
    async function loadCacheStatus() {
      if (!selectedDataset) {
        setCacheStatus(null)
        return
      }
      try {
        const data = await fetchScoreStatus(selectedDataset, ['pa', 'lp', 'pa_lp'], selectedIsCustom)
        if (!cancelled) setCacheStatus(data)
      } catch {
        if (!cancelled) setCacheStatus(null)
      }
    }
    loadCacheStatus()
    return () => {
      cancelled = true
    }
  }, [selectedDataset, selectedIsCustom])

  function updateStageCount(count: number) {
    const next = Math.max(1, Math.min(8, count))
    setStageCount(next)
    setStagePercents(safeStagePercentInputs(targetPercent, next))
  }

  function updateTarget(value: number) {
    const next = Math.max(1, Math.min(100, value))
    setTargetPercent(next)
    setStagePercents(safeStagePercentInputs(next, stageCount))
  }

  function updateStagePercent(index: number, value: number) {
    setStagePercents((prev) => prev.map((item, idx) => idx === index ? Math.max(0, Math.min(100, value)) : item))
  }

  function autofillLastStage() {
    if (stagePercents.length === 0) return
    const used = stagePercents.slice(0, -1).reduce((sum, value) => sum + value, 0)
    const last = Number(Math.max(0, targetPercent - used).toFixed(2))
    setStagePercents((prev) => prev.map((value, idx) => idx === prev.length - 1 ? last : value))
  }

  function toggleMethod(method: IterativeMethodId) {
    setMethods((prev) => {
      if (prev.includes(method)) return prev.filter((item) => item !== method)
      return [...prev, method]
    })
  }

  async function runExperiment() {
    if (!selectedDataset) {
      setError('Choose a dataset first.')
      return
    }
    if (methods.length === 0) {
      setError('Choose at least one method: PA, LP, or PA+LP.')
      return
    }
    if (!stageSumValid) {
      setError(`Stage percentages sum to ${stageSum.toFixed(2)}%, but the final target is ${targetPercent.toFixed(2)}%. Use auto-fill last stage or adjust the stages.`)
      return
    }
    if (!regionSumValid) {
      setError('Low score region % + High score region % must be 100% or less.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await runIterativeExtractionExperiment({
        datasetId: selectedDataset,
        methodIds: methods,
        targetPercent,
        stagePercents,
        lowRegionPercent,
        highRegionPercent,
        scoreSource,
        sessionId,
        isCustom: selectedIsCustom,
      })
      setResponse(res)
      const firstMethod = methods.find((method) => res.methods[method]) ?? 'compare_all'
      setActiveTab(firstMethod)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Experiment failed.')
    } finally {
      setLoading(false)
    }
  }

  const availableTabs: MethodTab[] = response ? [...(Object.keys(response.methods) as IterativeMethodId[]), 'compare_all'] : []

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-100 bg-gradient-to-br from-white via-slate-50 to-teal-bg/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-teal-bg px-3 py-1 text-xs font-semibold text-teal">New research lab</div>
            <h2 className="mt-3 text-2xl font-bold text-navy">Iterative Anomaly Extraction Study</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Compare one-shot backbone extraction with progressive stages. Each stage percentage is calculated from the original graph size, while Isolation Forest is refit on the remaining score table to reveal secondary anomalies.
            </p>
          </div>
          <div className="rounded-2xl border border-white/70 bg-white/80 p-4 text-xs text-gray-500 shadow-sm">
            <div className="font-bold text-navy">Rule reminder</div>
            <div className="mt-1">Stage 1 = p₁ × original edges</div>
            <div>Stage 2 = p₂ × original edges</div>
            <div>Final = sum of selected stages</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr,1fr,1.2fr]">
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dataset</label>
            <select
              value={`${selectedIsCustom ? 'custom' : 'raw'}:${selectedDataset}`}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':')
                setSelectedDataset(id)
                setSelectedIsCustom(kind === 'custom')
              }}
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal"
            >
              {datasetOptions.map((option) => <option key={`${option.isCustom}:${option.id}`} value={`${option.isCustom ? 'custom' : 'raw'}:${option.id}`}>{option.label}</option>)}
            </select>
            <div className="mt-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Score source</label><div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">Saved score status: <strong>PA</strong> {cacheStatus?.methods?.pa?.status ?? 'missing'}, <strong>LP</strong> {cacheStatus?.methods?.lp?.status ?? 'missing'}, <strong>PA+LP</strong> {cacheStatus?.methods?.pa_lp?.status ?? 'missing'}.</div>
              <select value={scoreSource} onChange={(e) => setScoreSource(e.target.value as ContaminationScoreSource)} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal">
                <option value="auto">Auto reuse saved scores</option>
                <option value="session_scores">Use current session scores</option>
                <option value="recompute">Force recompute</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Methods</label>
            <div className="mt-3 grid gap-2">
              {METHOD_OPTIONS.map((method) => (
                <button
                  key={method}
                  onClick={() => toggleMethod(method)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${methods.includes(method) ? 'border-teal bg-teal-bg text-teal' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  <span className="flex items-center gap-2"><MethodBadge id={method} /> {METHOD_MAP[method]?.label}</span>
                  <span className="text-xs font-semibold">{methods.includes(method) ? 'Selected' : 'Add'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Final backbone %</label>
                <input type="number" min={1} max={100} value={targetPercent} onChange={(e) => updateTarget(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stages</label>
                <input type="number" min={1} max={8} value={stageCount} onChange={(e) => updateStageCount(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal" />
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {stagePercents.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-16 text-xs font-semibold text-gray-500">Stage {index + 1}</span>
                  <input type="number" min={0} max={100} value={value} onChange={(e) => updateStagePercent(index, Number(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal" />
                  <span className="text-xs text-gray-500">%</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className={`text-xs font-semibold ${stageSumValid ? 'text-teal' : 'text-coral'}`}>Sum: {stageSum.toFixed(2)}% / Target: {targetPercent.toFixed(2)}%</span>
              <button className="text-xs font-semibold text-teal hover:underline" onClick={autofillLastStage}>Auto-fill last stage</button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Score region controls</label>
              <p className="mt-1 text-xs text-gray-500">
                Low region = bottom X% of raw scores, high region = top Y% of raw scores, middle = the remaining score range. These regions are used in the circle lens, tables, and scatter guides.
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${regionSumValid ? 'border-teal/30 bg-teal-bg text-teal' : 'border-coral/30 bg-coral-bg text-coral'}`}>
              Middle region: {pct(Math.max(0, 100 - lowRegionPercent - highRegionPercent))}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Low score region %</label>
              <input type="number" min={0} max={100} value={lowRegionPercent} onChange={(e) => setLowRegionPercent(Math.max(0, Math.min(100, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">High score region %</label>
              <input type="number" min={0} max={100} value={highRegionPercent} onChange={(e) => setHighRegionPercent(Math.max(0, Math.min(100, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal" />
            </div>
            <div className="rounded-xl bg-slate-50 border border-gray-100 px-4 py-3 text-xs text-gray-600">
              <div><span className="font-semibold text-navy">Example:</span> low 20% + high 20% → middle 60%.</div>
              <div className="mt-1">low 50% + high 50% → no middle region.</div>
            </div>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-coral/20 bg-coral-bg px-4 py-3 text-sm text-coral">{error}</div>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-gray-500">Session: <span className="font-mono">{sessionId}</span></div>
          <Button onClick={runExperiment} loading={loading} disabled={!stageSumValid || !regionSumValid || methods.length === 0}>Run iterative experiment</Button>
        </div>
      </div>

      {!response ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8">
          <EmptyState message="Run the iterative experiment to see method tabs, score-region circles, scatter plots, graph overlays, and the Compare All tab." />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {availableTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === tab ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {tab === 'compare_all' ? 'Compare All' : methodLabel(tab)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            {activeTab === 'compare_all'
              ? <CompareAllTab response={response} />
              : response.methods[activeTab as IterativeMethodId]
                ? <MethodResultTab result={response.methods[activeTab as IterativeMethodId]!} />
                : <EmptyState message="No result for this method." />}
          </div>
        </div>
      )}
    </div>
  )
}
