import React, { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
} from 'recharts'
import type { AnomalyInspector, ScoreHistogramBin, ScoreStats } from '../../types'
import PaperExportButton from '../export/PaperExportButton'

interface PreviousRunInfo {
  mode: 'auto' | 'manual'
  contaminationLabel: string
  threshold?: number | null
  flagged?: number
}

interface Props {
  inspector: AnomalyInspector
  methodColor: string
  rows: Record<string, any>[]
  previousRun?: PreviousRunInfo | null
}

type MainView = 'raw' | 'transformed' | 'model'
type FeatureView = 'pa' | 'lp'

const MULTI_FEATURE_COLUMNS = {
  pa: {
    label: 'PA',
    rawKey: 'preferential_attachment_1',
    transformedKey: 'preferential_attachment_1_transformed',
    rawTitle: 'PA raw score',
    transformedTitle: 'PA model input',
    rawXAxisLabel: 'PA raw score',
  },
  lp: {
    label: 'LP',
    rawKey: 'local_path_index_1',
    transformedKey: 'local_path_index_1_transformed',
    rawTitle: 'LP raw score',
    transformedTitle: 'LP model input',
    rawXAxisLabel: 'LP raw score',
  },
} as const

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
      <div className="text-base font-semibold text-gray-700">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function formatStats(stats: ScoreStats) {
  return [
    { label: 'Min', value: stats.min.toFixed(4) },
    { label: 'Max', value: stats.max.toFixed(4) },
    { label: 'Mean', value: stats.mean.toFixed(4) },
    { label: 'Median', value: stats.median.toFixed(4) },
    { label: 'Std', value: stats.std.toFixed(4) },
    { label: 'Skewness', value: stats.skewness.toFixed(4) },
  ]
}

function buildScoreStatsFromRows(rows: Record<string, any>[], key: string): ScoreStats {
  const values = rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      std: 0,
      skewness: 0,
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const std = Math.sqrt(variance)
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]

  let skewness = 0
  if (values.length > 2 && std > 0) {
    const thirdMoment =
      values.reduce((sum, value) => sum + ((value - mean) / std) ** 3, 0) / values.length
    skewness = thirdMoment
  }

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    std,
    skewness,
  }
}

function buildHistogramFromRows(
  rows: Record<string, any>[],
  valueKey: string,
  anomalyKey: string,
  bins = 20,
): ScoreHistogramBin[] {
  const points = rows
    .map((row) => ({
      value: Number(row[valueKey]),
      anomaly: Number(row[anomalyKey]) === -1,
    }))
    .filter((item) => Number.isFinite(item.value))

  if (points.length === 0) return []

  const values = points.map((item) => item.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const width = max === min ? 1 : (max - min) / bins

  const histogram: ScoreHistogramBin[] = Array.from({ length: bins }, (_, index) => {
    const left = min + index * width
    const right = index === bins - 1 ? max : left + width
    return {
      bin_left: left,
      bin_right: right,
      bin_center: (left + right) / 2,
      total: 0,
      anomalies: 0,
      normal: 0,
    }
  })

  points.forEach((item) => {
    const index = width === 0 ? 0 : Math.min(bins - 1, Math.max(0, Math.floor((item.value - min) / width)))
    histogram[index].total += 1
    if (item.anomaly) histogram[index].anomalies += 1
    else histogram[index].normal += 1
  })

  return histogram
}

function HistogramBlock({
  title,
  bins,
  color,
  xLabel,
  exportConfig,
}: {
  title: string
  bins: ScoreHistogramBin[]
  color: string
  xLabel: string
  exportConfig: any
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm font-semibold text-navy">{title}</div>
        <PaperExportButton config={exportConfig} />
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={bins} margin={{ top: 10, right: 10, left: -20, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="bin_center"
            tickFormatter={(v) => Number(v).toFixed(2)}
            tick={{ fontSize: 11 }}
            label={{ value: xLabel, position: 'insideBottom', offset: -6, fontSize: 11 }}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            labelFormatter={(v) => `Bin center ≈ ${Number(v).toFixed(4)}`}
            formatter={(val, name) => [
              val,
              name === 'anomalies' ? 'Anomaly edges' : 'Normal edges',
            ]}
          />
          <Legend />
          <Bar dataKey="normal" stackId="a" fill="#d1d5db" name="normal" />
          <Bar dataKey="anomalies" stackId="a" fill={color} name="anomalies" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function edgeLabel(row: Record<string, any>, idx: number) {
  if ('source' in row && 'target' in row) {
    return `${row.source} — ${row.target}`
  }
  if ('u' in row && 'v' in row) {
    return `${row.u} — ${row.v}`
  }
  if ('node1' in row && 'node2' in row) {
    return `${row.node1} — ${row.node2}`
  }
  return `edge_${idx + 1}`
}

function selectedEdgeCount(inspector: AnomalyInspector, rows: Record<string, any>[], anomalyKey: string) {
  if (inspector.selection_count != null) return Number(inspector.selection_count)
  if (inspector.counts.selection_count != null) return Number(inspector.counts.selection_count)
  if (inspector.counts.flagged != null) return Number(inspector.counts.flagged)
  return rows.filter((row) => Number(row[anomalyKey]) === -1).length
}

export default function ScoreInspectorSection({
  inspector,
  methodColor,
  rows,
  previousRun,
}: Props) {
  const [mainView, setMainView] = useState<MainView>('raw')
  const [featureView, setFeatureView] = useState<FeatureView>('pa')

  const isMultiFeature =
    inspector.method_id === 'pa_lp' &&
    rows.length > 0 &&
    rows.some((row) => MULTI_FEATURE_COLUMNS.pa.rawKey in row) &&
    rows.some((row) => MULTI_FEATURE_COLUMNS.lp.rawKey in row)

  const scoreColumn = inspector.score_column
  const transformedKey = `${scoreColumn}_transformed`
  const scoreSamplesKey = `${scoreColumn}_if_score_samples`
  const decisionKey = `${scoreColumn}_if_decision_function`
  const anomalyKey = `${scoreColumn}_anomaly`
  const rankKey = `${scoreColumn}_if_rank`

  const featureConfig = isMultiFeature
    ? MULTI_FEATURE_COLUMNS[featureView]
    : {
        label: inspector.method_id.toUpperCase(),
        rawKey: scoreColumn,
        transformedKey,
        rawTitle: 'Raw score',
        transformedTitle: 'Model input',
        rawXAxisLabel: 'Raw score',
      }

  const currentViewMeta = {
    raw: {
      title: featureConfig.rawTitle,
      description: isMultiFeature
        ? `This is the ${featureConfig.label} feature before the joint PA+LP Isolation Forest model.`
        : 'This is the score before preprocessing and before Isolation Forest.',
      xLabel: featureConfig.rawXAxisLabel,
      valueKey: featureConfig.rawKey,
    },
    transformed: {
      title: featureConfig.transformedTitle,
      description: isMultiFeature
        ? `This is the transformed ${featureConfig.label} feature used inside the joint PA+LP Isolation Forest input.`
        : 'This is the score after preprocessing. These values are sent into Isolation Forest.',
      xLabel: `${featureConfig.label} transformed score`,
      valueKey: featureConfig.transformedKey,
    },
    model: {
      title: isMultiFeature ? 'Joint model output' : 'Model output',
      description: isMultiFeature
        ? 'This view shows the Isolation Forest output from the joint [PA, LP] feature space. The PA/LP switch only changes which feature you compare against that shared ranking.'
        : 'This view focuses on Isolation Forest output scores and anomaly decisions.',
      xLabel: 'score_samples',
      valueKey: scoreSamplesKey,
    },
  } as const

  const current = currentViewMeta[mainView]
  const currentStats = useMemo(
    () => buildScoreStatsFromRows(rows, current.valueKey),
    [rows, current.valueKey],
  )
  const currentHistogram = useMemo(
    () => buildHistogramFromRows(rows, current.valueKey, anomalyKey, 20),
    [rows, current.valueKey, anomalyKey],
  )

  const sortedData = useMemo(() => {
    const copied = rows
      .map((row) => ({
        row,
        value: Number(row[current.valueKey]),
      }))
      .filter((item) => Number.isFinite(item.value))

    copied.sort((a, b) => a.value - b.value)

    return copied.map((item, idx) => ({
      idx: idx + 1,
      value: item.value,
      anomaly: Number(item.row[anomalyKey]) === -1 ? 1 : 0,
    }))
  }, [rows, current.valueKey, anomalyKey])

  const scatterDecisionNormal = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) !== -1)
      .map((r) => ({
        x: Number(r[featureConfig.rawKey]),
        y: Number(r[decisionKey]),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  }, [rows, anomalyKey, featureConfig.rawKey, decisionKey])

  const scatterDecisionAnomaly = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) === -1)
      .map((r) => ({
        x: Number(r[featureConfig.rawKey]),
        y: Number(r[decisionKey]),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  }, [rows, anomalyKey, featureConfig.rawKey, decisionKey])

  const scatterSamplesNormal = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) !== -1)
      .map((r) => ({
        x: Number(r[featureConfig.rawKey]),
        y: Number(r[scoreSamplesKey]),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  }, [rows, anomalyKey, featureConfig.rawKey, scoreSamplesKey])

  const scatterSamplesAnomaly = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) === -1)
      .map((r) => ({
        x: Number(r[featureConfig.rawKey]),
        y: Number(r[scoreSamplesKey]),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  }, [rows, anomalyKey, featureConfig.rawKey, scoreSamplesKey])

  const rankedData = useMemo(() => {
    return [...rows]
      .sort((a, b) => Number(a[rankKey]) - Number(b[rankKey]))
      .map((row) => ({
        rank: Number(row[rankKey]),
        scoreSamples: Number(row[scoreSamplesKey]),
        decision: Number(row[decisionKey]),
        anomaly: Number(row[anomalyKey]),
      }))
      .filter((point) => Number.isFinite(point.rank) && Number.isFinite(point.scoreSamples))
  }, [rows, rankKey, scoreSamplesKey, decisionKey, anomalyKey])

  const topRows = useMemo(() => {
    return [...rows]
      .sort((a, b) => Number(a[rankKey]) - Number(b[rankKey]))
      .slice(0, 20)
  }, [rows, rankKey])

  const selectedCount = selectedEdgeCount(inspector, rows, anomalyKey)
  const totalCount = inspector.counts.total ?? rows.length
  const scatterScoreLabel = `${featureConfig.label} score`
  const scatterSelectionSubtitle = `Backbone edges selected: ${selectedCount} / ${totalCount}`

  const previousModeLabel = 'Top-percentage cut'


  const histogramExportConfig = {
    figureType: 'histogram' as const,
    title: `${current.title} histogram`,
    filename: `${inspector.method_id}-${mainView}-${featureConfig.label.toLowerCase()}-histogram`,
    payload: {
      title: `${current.title} histogram`,
      subtitle: current.description,
      bins: currentHistogram,
      x_label: current.xLabel,
      y_label: 'Edge count',
      accent_color: methodColor,
      anomaly_label: 'Anomaly edges',
      normal_label: 'Normal edges',
    },
  }

  const sortedExportConfig = {
    figureType: 'line' as const,
    title: `Sorted ${current.title.toLowerCase()} values`,
    filename: `${inspector.method_id}-${mainView}-${featureConfig.label.toLowerCase()}-sorted-values`,
    payload: {
      title: `Sorted ${current.title.toLowerCase()} values`,
      subtitle: current.description,
      rows: sortedData,
      x_key: 'idx',
      x_label: 'Edge index after sorting',
      y_label: current.title,
      series: [{ key: 'value', label: 'Sorted values', color: methodColor }],
    },
  }

  const scatterDecisionExportConfig = {
    figureType: 'scatter' as const,
    title: `${featureConfig.label} raw score vs decision function`,
    filename: `${inspector.method_id}-${featureConfig.label.toLowerCase()}-decision-scatter`,
    payload: {
      title: `${featureConfig.label} raw score vs decision function`,
      subtitle: 'Isolation Forest decision function against the raw feature values.',
      rows: [
        ...scatterDecisionNormal.map((p) => ({ ...p, category: 'Normal' })),
        ...scatterDecisionAnomaly.map((p) => ({ ...p, category: 'Anomaly' })),
      ],
      x_key: 'x',
      y_key: 'y',
      x_label: featureConfig.rawXAxisLabel,
      y_label: 'Decision function',
      group_key: 'category',
      groups: [
        { value: 'Normal', label: 'Normal', color: '#d1d5db' },
        { value: 'Anomaly', label: 'Anomaly', color: methodColor },
      ],
    },
  }

  const scatterSamplesExportConfig = {
    figureType: 'scatter' as const,
    title: `${featureConfig.label} score vs anomaly score`,
    filename: `${inspector.method_id}-${featureConfig.label.toLowerCase()}-anomaly-score-scatter`,
    payload: {
      title: `${featureConfig.label} score vs anomaly score`,
      subtitle: scatterSelectionSubtitle,
      rows: [
        ...scatterSamplesNormal.map((p) => ({ ...p, category: 'Normal' })),
        ...scatterSamplesAnomaly.map((p) => ({ ...p, category: 'Anomaly' })),
      ],
      x_key: 'x',
      y_key: 'y',
      x_label: scatterScoreLabel,
      y_label: 'Anomaly score',
      group_key: 'category',
      groups: [
        { value: 'Normal', label: 'Normal', color: '#d1d5db' },
        { value: 'Anomaly', label: 'Anomaly', color: methodColor },
      ],
    },
  }

  // Dedicated manuscript Figure 2 export; independent of the UI contamination.
  // Single-feature runs only: PA+LP score_samples are joint-model scores and
  // cannot be used for the requested PA-only / LP-only plots.
  const paperFigure2Method = inspector.method_id === 'pa' || inspector.method_id === 'lp'
    ? inspector.method_id : null
  const manuscriptRows = rows.map((r) => ({
    x: Number(r[featureConfig.rawKey]),
    y: Number(r[scoreSamplesKey]),
  }))
  const manuscriptInputsValid = manuscriptRows.length > 0 && manuscriptRows.every(
    (r) => Number.isFinite(r.x) && Number.isFinite(r.y)
  )
  const manuscriptIsRaw = rows.length > 0 && rows.every(
    (r) => r[`${scoreColumn}_preprocessing`] === 'raw' || r[`${scoreColumn}_preprocessing`] === 'none'
  )
  const figure2ExportConfig = {
    figureType: 'single_score_iforest' as const,
    title: `Figure 2 ${featureConfig.label} score vs Isolation Forest score`,
    filename: `figure2-${featureConfig.label.toLowerCase()}-single-score-iforest`,
    payload: {
      method: paperFigure2Method,
      rho: 0.20,
      raw_scores: manuscriptIsRaw,
      rows: manuscriptRows,
    },
  }

  const rankedExportConfig = {
    figureType: 'line' as const,
    title: 'Ranked abnormality plot (score_samples scale)',
    filename: `${inspector.method_id}-${featureConfig.label.toLowerCase()}-ranked-abnormality`,
    payload: {
      title: 'Ranked abnormality plot (score_samples scale)',
      subtitle: 'Lower ranks are more abnormal; the line shows score_samples across the anomaly ranking.',
      rows: rankedData,
      x_key: 'rank',
      x_label: 'Edge rank (1 = most abnormal)',
      y_label: 'score_samples',
      series: [{ key: 'scoreSamples', label: 'score_samples', color: methodColor }],
      vline_x: inspector.cutoff_rank ?? inspector.counts.cutoff_rank ?? null,
    },
  }

  const topRowsExportConfig = {
    figureType: 'table' as const,
    title: 'Top 20 most abnormal edges',
    filename: `${inspector.method_id}-${featureConfig.label.toLowerCase()}-top-anomalies`,
    payload: {
      title: 'Top 20 most abnormal edges',
      subtitle: 'Sorted by abnormality rank.',
      columns: [
        { key: 'rank', label: 'Rank' },
        { key: 'edge', label: 'Edge' },
        { key: 'raw', label: `${featureConfig.label} raw` },
        { key: 'transformed', label: `${featureConfig.label} transformed` },
        { key: 'score_samples', label: 'score_samples' },
        { key: 'decision_function', label: 'IF score' },
        { key: 'label', label: 'Label' },
      ],
      rows: topRows.map((row, idx) => ({
        rank: row[rankKey],
        edge: edgeLabel(row, idx),
        raw: Number(row[featureConfig.rawKey]).toFixed(4),
        transformed: Number(row[featureConfig.transformedKey]).toFixed(4),
        score_samples: Number(row[scoreSamplesKey]).toFixed(6),
        decision_function: Number(row[decisionKey]).toFixed(6),
        label: Number(row[anomalyKey]) === -1 ? 'Anomaly' : 'Normal',
      })),
    },
  }

  return (
    <div className="space-y-6 mb-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        {isMultiFeature && (
          <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-teal-900 mb-1">PA+LP detail view</div>
                <p className="text-xs text-teal-800 max-w-3xl leading-5">
                  The anomaly ranking comes from the joint <strong>[PA, LP]</strong> model. Use the switch below to inspect either the PA feature or the LP feature against that same shared model output.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['pa', 'lp'] as FeatureView[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setFeatureView(item)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                      featureView === item
                        ? 'text-white'
                        : 'text-gray-600 bg-white border border-teal-200 hover:bg-teal-100'
                    }`}
                    style={featureView === item ? { backgroundColor: methodColor } : {}}
                  >
                    {MULTI_FEATURE_COLUMNS[item].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {(['raw', 'transformed', 'model'] as MainView[]).map((item) => (
            <button
              key={item}
              onClick={() => setMainView(item)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                mainView === item
                  ? 'text-white'
                  : 'text-gray-500 bg-gray-50 hover:bg-gray-100'
              }`}
              style={mainView === item ? { backgroundColor: methodColor } : {}}
            >
              {item === 'raw' ? 'Raw score' : item === 'transformed' ? 'Model input' : 'Model output'}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <div className="text-sm font-semibold text-navy">{current.title}</div>
          <p className="text-xs text-gray-500 mt-1">{current.description}</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
          {formatStats(currentStats).map((item) => (
            <StatCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>

        {previousRun && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
            <div className="text-sm font-semibold text-amber-900 mb-2">
              What changed from the previous applied run?
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="font-semibold text-amber-900">Previous mode:</span>{' '}
                {previousModeLabel}
              </div>
              <div>
                <span className="font-semibold text-amber-900">Previous contamination:</span>{' '}
                {previousRun.contaminationLabel}
              </div>
              <div>
                <span className="font-semibold text-amber-900">Previous cutoff rank:</span>{' '}
                {previousRun.threshold ?? '—'}
              </div>
              <div>
                <span className="font-semibold text-amber-900">Previous backbone edges:</span>{' '}
                {previousRun.flagged ?? '—'}
              </div>
            </div>
            <div className="mt-3 text-xs text-amber-800">
              The ranking is sorted from most anomalous to least anomalous. Changing contamination only changes how many top-ranked edges are kept.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <HistogramBlock
            title={`${current.title} histogram`}
            bins={currentHistogram}
            color={methodColor}
            xLabel={current.xLabel}
            exportConfig={histogramExportConfig}
          />

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-navy">Sorted {current.title.toLowerCase()} values</div>
              <PaperExportButton config={sortedExportConfig} />
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={sortedData} margin={{ top: 10, right: 10, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="idx"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Edge index after sorting', position: 'insideBottom', offset: -6, fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={methodColor}
                  dot={false}
                  strokeWidth={2}
                  name="Sorted values"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {paperFigure2Method && (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-navy">Manuscript Figure 2 — {featureConfig.label} standalone panel</div>
              <div className="text-xs text-gray-600 mt-1">All edges · raw score vs single-feature Isolation Forest score_samples · ρ = 0.20 · fixed method color · dashed cutoff · no legend or title. Export PDF/PNG separately for LaTeX.</div>
              {!manuscriptIsRaw && <div className="text-xs text-red-700 mt-1">Run anomaly labeling with Raw / No preprocessing first; transformed IF scores are not eligible for this paper figure.</div>}
              {!manuscriptInputsValid && <div className="text-xs text-red-700 mt-1">Missing or invalid edge scores; cannot export this panel.</div>}
            </div>
            {manuscriptIsRaw && manuscriptInputsValid && <PaperExportButton config={figure2ExportConfig} />}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-navy">Scatter: {featureConfig.label} raw score vs sklearn decision score</div>
              <PaperExportButton config={scatterDecisionExportConfig} />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={featureConfig.rawXAxisLabel}
                  tick={{ fontSize: 11 }}
                  label={{ value: featureConfig.rawXAxisLabel, position: 'insideBottom', offset: -6, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Decision function"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Decision function', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter name="Normal" data={scatterDecisionNormal} fill="#d1d5db" stroke="none" />
<Scatter name="Anomaly" data={scatterDecisionAnomaly} fill={methodColor} stroke="none" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold text-navy">Scatter: {featureConfig.label} score vs anomaly score</div>
                <div className="text-xs text-gray-500 mt-1">{scatterSelectionSubtitle}</div>
              </div>
              <PaperExportButton config={scatterSamplesExportConfig} />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={scatterScoreLabel}
                  tick={{ fontSize: 11 }}
                  label={{ value: scatterScoreLabel, position: 'insideBottom', offset: -6, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Anomaly score"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Anomaly score', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter name="Normal" data={scatterSamplesNormal} fill="#d1d5db" stroke="none" />
<Scatter name="Anomaly" data={scatterSamplesAnomaly} fill={methodColor} stroke="none" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-navy">Ranked abnormality plot (score_samples scale)</div>
              <PaperExportButton config={rankedExportConfig} />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={rankedData} margin={{ top: 10, right: 10, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="rank"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Edge rank (1 = most abnormal)', position: 'insideBottom', offset: -6, fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="scoreSamples"
                  stroke={methodColor}
                  dot={false}
                  strokeWidth={2}
                  name="score_samples"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-sm font-semibold text-navy mb-3">
              Top-percentage selection rule
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div className="font-semibold text-navy">Cutoff rank</div>
                <div className="mt-1">
                  {inspector.cutoff_rank ?? inspector.counts.cutoff_rank ?? '—'}
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div className="font-semibold text-navy">Selected percentage</div>
                <div className="mt-1">
                  {inspector.selection_fraction != null ? `${(inspector.selection_fraction * 100).toFixed(1)}%` : inspector.counts.selection_fraction != null ? `${(inspector.counts.selection_fraction * 100).toFixed(1)}%` : '—'}
                </div>
              </div>

              <div className="text-xs text-gray-500 leading-5">
                Isolation Forest ranks edges by abnormality using <strong>score_samples</strong> where lower values are more anomalous. The backbone is selected by taking the requested top percentage from this ranking.
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 gap-3">
            <div>
              <div className="text-sm font-semibold text-navy">Top 20 most abnormal edges</div>
              <div className="text-xs text-gray-500">Sorted by abnormality rank</div>
            </div>
            <PaperExportButton config={topRowsExportConfig} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2 pr-4">Edge</th>
                  <th className="py-2 pr-4">{featureConfig.label} raw</th>
                  <th className="py-2 pr-4">{featureConfig.label} transformed</th>
                  <th className="py-2 pr-4">score_samples</th>
                  <th className="py-2 pr-4">IF score</th>
                  <th className="py-2 pr-4">Label</th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((row, idx) => {
                  const isAnomaly = Number(row[anomalyKey]) === -1
                  return (
                    <tr key={idx} className="border-b border-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-700">{row[rankKey]}</td>
                      <td className="py-2 pr-4">{edgeLabel(row, idx)}</td>
                      <td className="py-2 pr-4">{Number(row[featureConfig.rawKey]).toFixed(4)}</td>
                      <td className="py-2 pr-4">{Number(row[featureConfig.transformedKey]).toFixed(4)}</td>
                      <td className="py-2 pr-4">{Number(row[scoreSamplesKey]).toFixed(6)}</td>
                      <td className="py-2 pr-4">{Number(row[decisionKey]).toFixed(6)}</td>
                      <td className="py-2 pr-4">
                        <span
                          className="px-2 py-1 rounded-full text-xs font-semibold"
                          style={{
                            backgroundColor: isAnomaly ? `${methodColor}20` : '#f3f4f6',
                            color: isAnomaly ? methodColor : '#6b7280',
                          }}
                        >
                          {isAnomaly ? 'Anomaly' : 'Normal'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
