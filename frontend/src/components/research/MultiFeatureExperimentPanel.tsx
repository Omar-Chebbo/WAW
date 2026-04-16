import React, { useEffect, useMemo, useState } from 'react'
import { runMultiFeatureExperiment, useDatasets } from '../../api/client'
import { Button, MethodBadge, StatCard } from '../ui'
import { METHOD_MAP } from '../../constants/methods'
import { useWorkflowStore } from '../../store/workflowStore'
import type {
  ContaminationScoreSource,
  Dataset,
  ExtremeEdgeRow,
  MultiFeatureExperimentResponse,
  MultiFeatureQuadrantCount,
  MultiFeatureScalingMode,
} from '../../types'
import MultiFeatureGraphPanel from './MultiFeatureGraphPanel'

interface DatasetOption {
  id: string
  label: string
  isCustom: boolean
}

function clampContamination(value: string) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return 0.1
  return Math.min(1.0, Math.max(0.01, parsed))
}

function quadrantLabel(value: string) {
  switch (value) {
    case 'high_pa_high_lp':
      return 'High PA / High LP'
    case 'high_pa_low_lp':
      return 'High PA / Low LP'
    case 'low_pa_high_lp':
      return 'Low PA / High LP'
    case 'low_pa_low_lp':
      return 'Low PA / Low LP'
    default:
      return value
  }
}

function categoryLabel(category: string) {
  switch (category) {
    case 'all_three':
      return 'Selected by all three'
    case 'only_multi':
      return 'Only PA+LP'
    case 'only_pa':
      return 'Only PA'
    case 'only_lp':
      return 'Only LP'
    case 'single_not_multi':
      return 'Single-feature only'
    default:
      return 'Not selected'
  }
}

function rankLabel(value: number | null | undefined) {
  return value ? `#${value}` : '—'
}

function boolPill(value: boolean, methodId: 'pa' | 'lp' | 'pa_lp') {
  const style = value
    ? methodId === 'pa'
      ? 'bg-violet-50 text-violet-700 border-violet-200'
      : methodId === 'lp'
        ? 'bg-orange-50 text-orange-700 border-orange-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-gray-50 text-gray-400 border-gray-200'

  return (
    <span className={`inline-flex items-center justify-center rounded-full border px-2 py-1 text-[11px] font-semibold ${style}`}>
      {value ? 'Yes' : 'No'}
    </span>
  )
}


function csvEscape(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  const csv = [headers, ...rows]
    .map((line) => line.map(csvEscape).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table'
}

function exportExtremeRows(title: string, rows: ExtremeEdgeRow[]) {
  downloadCsv(
    `${safeFilename(title)}.csv`,
    [
      'source',
      'target',
      'edge_key',
      'pa_score',
      'lp_score',
      'selected_by_pa',
      'selected_by_lp',
      'selected_by_pa_lp',
      'pa_rank',
      'lp_rank',
      'pa_lp_rank',
      'decision_function',
      'score_samples',
    ],
    rows.map((row) => [
      row.source,
      row.target,
      row.edge_key,
      row.pa_score,
      row.lp_score,
      row.selected_by_pa ? 'Yes' : 'No',
      row.selected_by_lp ? 'Yes' : 'No',
      row.selected_by_pa_lp ? 'Yes' : 'No',
      row.pa_rank ?? '',
      row.lp_rank ?? '',
      row.pa_lp_rank ?? '',
      row.decision_function ?? '',
      row.score_samples ?? '',
    ])
  )
}

function ScatterPlot({
  points,
  quadrantCounts,
}: {
  points: MultiFeatureExperimentResponse['scatter']['points']
  quadrantCounts: MultiFeatureQuadrantCount[]
}) {
  const width = 780
  const height = 420
  const padding = 52

  const bounds = useMemo(() => {
    const xs = points.map((point) => point.pa)
    const ys = points.map((point) => point.lp)
    const minX = Math.min(...xs, 0)
    const maxX = Math.max(...xs, 1)
    const minY = Math.min(...ys, 0)
    const maxY = Math.max(...ys, 1)
    return {
      minX,
      maxX,
      minY,
      maxY,
      medianX: xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0,
      medianY: ys.slice().sort((a, b) => a - b)[Math.floor(ys.length / 2)] ?? 0,
    }
  }, [points])

  function projectX(value: number) {
    const span = bounds.maxX - bounds.minX || 1
    return ((value - bounds.minX) / span) * (width - padding * 2) + padding
  }

  function projectY(value: number) {
    const span = bounds.maxY - bounds.minY || 1
    return height - (((value - bounds.minY) / span) * (height - padding * 2) + padding)
  }

  const categories = useMemo(() => {
    const defs = {
      all_three: { label: categoryLabel('all_three'), color: '#0F766E', count: 0 },
      only_multi: { label: categoryLabel('only_multi'), color: '#2563EB', count: 0 },
      only_pa: { label: categoryLabel('only_pa'), color: '#7C3AED', count: 0 },
      only_lp: { label: categoryLabel('only_lp'), color: '#C2410C', count: 0 },
      single_not_multi: { label: categoryLabel('single_not_multi'), color: '#B45309', count: 0 },
      none: { label: categoryLabel('none'), color: '#D7DEE8', count: 0 },
    }

    points.forEach((point) => {
      let key: keyof typeof defs = 'none'
      if (point.selected_by_pa && point.selected_by_lp && point.selected_by_pa_lp) key = 'all_three'
      else if (point.selected_by_pa_lp && !point.selected_by_pa && !point.selected_by_lp) key = 'only_multi'
      else if (point.selected_by_pa && !point.selected_by_lp && !point.selected_by_pa_lp) key = 'only_pa'
      else if (point.selected_by_lp && !point.selected_by_pa && !point.selected_by_pa_lp) key = 'only_lp'
      else if ((point.selected_by_pa || point.selected_by_lp) && !point.selected_by_pa_lp) key = 'single_not_multi'
      defs[key].count += 1
    })

    return defs
  }, [points])

  function pointStyle(point: MultiFeatureExperimentResponse['scatter']['points'][number]) {
    if (point.selected_by_pa && point.selected_by_lp && point.selected_by_pa_lp) return { fill: '#0F766E', r: 4.6, opacity: 0.88 }
    if (point.selected_by_pa_lp && !point.selected_by_pa && !point.selected_by_lp) return { fill: '#2563EB', r: 4.4, opacity: 0.88 }
    if (point.selected_by_pa && !point.selected_by_lp && !point.selected_by_pa_lp) return { fill: '#7C3AED', r: 4.0, opacity: 0.88 }
    if (point.selected_by_lp && !point.selected_by_pa && !point.selected_by_pa_lp) return { fill: '#C2410C', r: 4.0, opacity: 0.88 }
    if ((point.selected_by_pa || point.selected_by_lp) && !point.selected_by_pa_lp) return { fill: '#B45309', r: 3.8, opacity: 0.82 }
    return { fill: '#D7DEE8', r: 2.2, opacity: 0.45 }
  }

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr),320px] gap-5">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold text-navy">PA vs LP feature space</div>
            <div className="text-xs text-gray-500 mt-1">
              Hover any dot to see the edge and whether it was kept by PA, LP, or PA+LP.
            </div>
          </div>
          <div className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-medium text-gray-600">
            Dashed lines = PA / LP medians
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-slate-50 overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[420px]">
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const x = padding + (width - padding * 2) * ratio
              const y = padding + (height - padding * 2) * ratio
              return (
                <g key={ratio}>
                  <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#E5E7EB" strokeWidth={1} />
                  <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#E5E7EB" strokeWidth={1} />
                </g>
              )
            })}

            <line x1={projectX(bounds.medianX)} y1={padding} x2={projectX(bounds.medianX)} y2={height - padding} stroke="#94A3B8" strokeDasharray="6 6" />
            <line x1={padding} y1={projectY(bounds.medianY)} x2={width - padding} y2={projectY(bounds.medianY)} stroke="#94A3B8" strokeDasharray="6 6" />

            {points.map((point) => {
              const style = pointStyle(point)
              return (
                <circle
                  key={point.edge_key}
                  cx={projectX(point.pa)}
                  cy={projectY(point.lp)}
                  r={style.r}
                  fill={style.fill}
                  fillOpacity={style.opacity}
                  stroke="#ffffff"
                  strokeWidth={style.r > 3 ? 0.9 : 0.4}
                >
                  <title>
                    {`${point.source} - ${point.target}\nPA=${point.pa}\nLP=${point.lp}\nPA: ${point.selected_by_pa ? 'selected' : 'not selected'}\nLP: ${point.selected_by_lp ? 'selected' : 'not selected'}\nPA+LP: ${point.selected_by_pa_lp ? 'selected' : 'not selected'}`}
                  </title>
                </circle>
              )
            })}

            <text x={width / 2} y={height - 12} textAnchor="middle" fontSize="12" fill="#475569" fontWeight={600}>PA score</text>
            <text x={18} y={height / 2} textAnchor="middle" fontSize="12" fill="#475569" fontWeight={600} transform={`rotate(-90, 18, ${height / 2})`}>LP score</text>
          </svg>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Plot legend</div>
          <div className="space-y-2.5">
            {Object.entries(categories).map(([key, item]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-navy truncate">{item.label}</span>
                </div>
                <span className="text-xs font-semibold text-gray-500">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Quadrant counts</div>
          <div className="space-y-3">
            {quadrantCounts.map((item) => (
              <div key={item.quadrant} className="rounded-xl border border-gray-100 px-3 py-2">
                <div className="text-sm font-medium text-navy">{quadrantLabel(item.quadrant)}</div>
                <div className="text-xs text-gray-500 mt-1">{item.selected} selected of {item.total}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}


function percentText(value: number | undefined) {
  return `${value ?? 0}%`
}

function regionDisplay(region: string) {
  switch (region) {
    case 'high':
      return 'High 10%'
    case 'low':
      return 'Low 10%'
    default:
      return 'Middle 80%'
  }
}

function BalanceBar({
  title,
  balance,
  accent,
}: {
  title: string
  balance: MultiFeatureExperimentResponse['multi_feature_profile']['pa_score_balance']
  accent: 'pa' | 'lp'
}) {
  const segments = [
    { label: 'Low 10%', pct: balance.bottom_10_pct, count: balance.bottom_10_count, className: accent === 'pa' ? 'bg-violet-200' : 'bg-orange-200' },
    { label: 'Middle 80%', pct: balance.middle_80_pct, count: balance.middle_80_count, className: accent === 'pa' ? 'bg-violet-500' : 'bg-orange-500' },
    { label: 'High 10%', pct: balance.top_10_pct, count: balance.top_10_count, className: accent === 'pa' ? 'bg-violet-800' : 'bg-orange-800' },
  ]

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold text-navy">{title}</div>
          <div className="text-xs text-gray-500 mt-1">Distribution of PA+LP-selected edges by this score.</div>
        </div>
        <div className="text-xs font-semibold text-gray-500">{balance.selected_total} selected</div>
      </div>

      <div className="h-5 w-full overflow-hidden rounded-full bg-gray-100 flex">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={`${segment.className} transition-all`}
            style={{ width: `${Math.max(segment.pct, segment.pct > 0 ? 2 : 0)}%` }}
            title={`${segment.label}: ${segment.pct}% (${segment.count} edges)`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        {segments.map((segment) => (
          <div key={segment.label} className="rounded-xl border border-gray-100 bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{segment.label}</div>
            <div className="text-xl font-bold text-navy mt-1">{percentText(segment.pct)}</div>
            <div className="text-xs text-gray-500 mt-1">{segment.count} edges</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MultiFeatureCompositionVisual({
  profile,
}: {
  profile: MultiFeatureExperimentResponse['multi_feature_profile']
}) {
  const maxCell = Math.max(...profile.joint_grid.map((cell) => cell.selected_count), 1)
  const regionOrder = ['high', 'middle', 'low']

  function findCell(paRegion: string, lpRegion: string) {
    return profile.joint_grid.find((cell) => cell.pa_region === paRegion && cell.lp_region === lpRegion)
  }

  return (
    <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-bold text-navy">PA+LP backbone score fingerprint</div>
          <div className="text-sm text-gray-500 mt-1 max-w-4xl">
            This visual looks only at the edges selected by the multi-feature PA+LP Isolation Forest, then shows whether those edges came from high, low, or middle PA and LP score regions.
          </div>
        </div>
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
          {profile.selected_total} PA+LP backbone edges
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <BalanceBar title="Where PA+LP edges fall in the PA score distribution" balance={profile.pa_score_balance} accent="pa" />
        <BalanceBar title="Where PA+LP edges fall in the LP score distribution" balance={profile.lp_score_balance} accent="lp" />
      </div>

      <div className="grid xl:grid-cols-[320px,minmax(0,1fr)] gap-5 items-start">
        <div className="rounded-2xl border border-gray-100 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-navy">How to read this fingerprint</div>
          <div className="text-sm text-gray-600 leading-6 mt-2">
            Each cell shows how many PA+LP backbone edges came from one PA region and one LP region. A darker cell means the multi-feature model selected more edges from that score combination.
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 p-4 overflow-auto">
          <div className="grid grid-cols-[96px_repeat(3,minmax(110px,1fr))] gap-2 min-w-[560px]">
            <div />
            {regionOrder.map((lpRegion) => (
              <div key={lpRegion} className="text-center text-xs font-semibold uppercase tracking-wide text-orange-600">
                LP {regionDisplay(lpRegion)}
              </div>
            ))}

            {regionOrder.map((paRegion) => (
              <React.Fragment key={paRegion}>
                <div className="flex items-center justify-end pr-2 text-xs font-semibold uppercase tracking-wide text-violet-600">
                  PA {regionDisplay(paRegion)}
                </div>
                {regionOrder.map((lpRegion) => {
                  const cell = findCell(paRegion, lpRegion)
                  const selected = cell?.selected_count ?? 0
                  const total = cell?.total_count ?? 0
                  const pct = cell?.pct_of_selected ?? 0
                  const opacity = 0.12 + (selected / maxCell) * 0.78
                  return (
                    <div
                      key={`${paRegion}-${lpRegion}`}
                      className="rounded-2xl border border-emerald-100 p-4 text-center min-h-[105px] flex flex-col justify-center"
                      style={{ backgroundColor: `rgba(16, 185, 129, ${opacity})` }}
                      title={`${selected} PA+LP selected edges out of ${total} total edges in this score zone`}
                    >
                      <div className="text-2xl font-bold text-navy">{selected}</div>
                      <div className="text-xs font-semibold text-gray-700 mt-1">{percentText(pct)} of PA+LP</div>
                      <div className="text-[11px] text-gray-500 mt-1">of {total} edges in zone</div>
                    </div>
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ExtremeTable({
  title,
  rows,
  primaryMethod,
}: {
  title: string
  rows: ExtremeEdgeRow[]
  primaryMethod: 'pa' | 'lp'
}) {
  const primaryLabel = primaryMethod === 'pa' ? 'PA score' : 'LP score'
  const secondaryLabel = primaryMethod === 'pa' ? 'LP score' : 'PA score'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold text-navy">{title}</div>
          <div className="text-xs text-gray-500 mt-1">All edges are listed. Scroll inside the table to inspect everything.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-medium text-gray-600">
            {rows.length} rows
          </div>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => exportExtremeRows(title, rows)} disabled={!rows.length}>
            Download CSV
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 overflow-auto h-[440px]">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(229,231,235,1)]">
            <tr className="text-left text-gray-400">
              <th className="py-3 px-3">Edge</th>
              <th className="py-3 px-3">{primaryLabel}</th>
              <th className="py-3 px-3">{secondaryLabel}</th>
              <th className="py-3 px-3">PA</th>
              <th className="py-3 px-3">LP</th>
              <th className="py-3 px-3">PA+LP</th>
              <th className="py-3 px-3">PA rank</th>
              <th className="py-3 px-3">LP rank</th>
              <th className="py-3 px-3">PA+LP rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.edge_key}-${title}`} className="border-b border-gray-50 last:border-b-0 text-gray-700 hover:bg-slate-50/80">
                <td className="py-2.5 px-3 font-medium whitespace-nowrap">{row.source} - {row.target}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{(primaryMethod === 'pa' ? row.pa_score : row.lp_score).toFixed(4)}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{(primaryMethod === 'pa' ? row.lp_score : row.pa_score).toFixed(4)}</td>
                <td className="py-2.5 px-3">{boolPill(row.selected_by_pa, 'pa')}</td>
                <td className="py-2.5 px-3">{boolPill(row.selected_by_lp, 'lp')}</td>
                <td className="py-2.5 px-3">{boolPill(row.selected_by_pa_lp, 'pa_lp')}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{rankLabel(row.pa_rank)}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{rankLabel(row.lp_rank)}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{rankLabel(row.pa_lp_rank)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function MultiFeatureExperimentPanel() {
  const { data: datasets = [] } = useDatasets()
  const { datasetId: wizardDatasetId, isCustomDataset, sessionId } = useWorkflowStore()

  const datasetOptions = useMemo<DatasetOption[]>(() => {
    const options = datasets.map((dataset: Dataset) => ({
      id: dataset.id,
      label: dataset.filename,
      isCustom: false,
    }))

    if (wizardDatasetId && isCustomDataset && !options.some((option) => option.id === wizardDatasetId)) {
      options.unshift({
        id: wizardDatasetId,
        label: `${wizardDatasetId} (current custom upload)`,
        isCustom: true,
      })
    }

    return options
  }, [datasets, wizardDatasetId, isCustomDataset])

  const [datasetSelection, setDatasetSelection] = useState<DatasetOption | null>(datasetOptions[0] ?? null)
  const [contaminationValue, setContaminationValue] = useState('0.10')
  const [scoreSource, setScoreSource] = useState<ContaminationScoreSource>('compute_fresh')
  const [scalingMode, setScalingMode] = useState<MultiFeatureScalingMode>('none')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MultiFeatureExperimentResponse | null>(null)

  useEffect(() => {
    if (!datasetSelection && datasetOptions[0]) {
      setDatasetSelection(datasetOptions[0])
    }
  }, [datasetOptions, datasetSelection])

  async function handleRun() {
    if (!datasetSelection) {
      setError('Choose a dataset first.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await runMultiFeatureExperiment({
        datasetId: datasetSelection.id,
        contamination: clampContamination(contaminationValue),
        scoreSource,
        sessionId,
        isCustom: datasetSelection.isCustom,
        scalingMode,
      })
      setResult(response)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Failed to run the multi-feature study.')
    } finally {
      setLoading(false)
    }
  }

  const methodCards = result ? [result.cases.pa, result.cases.lp, result.cases.pa_lp] : []

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-navy">Multi-Feature Anomaly Detection Study</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-4xl">
            Compare PA alone, LP alone, and PA+LP together under the same same top-percentage backbone setting. This page also shows which extreme edges are kept and how the three backbone graphs differ visually.
          </p>
        </div>
        <Button onClick={handleRun} loading={loading}>Run study</Button>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-5">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Dataset</div>
            <select
              value={datasetSelection?.id ?? ''}
              onChange={(e) => {
                const next = datasetOptions.find((option) => option.id === e.target.value) ?? null
                setDatasetSelection(next)
              }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              {datasetOptions.map((option) => (
                <option key={`${option.isCustom ? 'custom' : 'raw'}-${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Contamination</div>
              <input
                value={contaminationValue}
                onChange={(e) => setContaminationValue(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Score source</div>
              <select value={scoreSource} onChange={(e) => setScoreSource(e.target.value as ContaminationScoreSource)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
                <option value="compute_fresh">Compute fresh</option>
                <option value="session_scores">Reuse wizard scores</option>
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Multi-feature scaling</div>
            <select value={scalingMode} onChange={(e) => setScalingMode(e.target.value as MultiFeatureScalingMode)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <option value="none">Raw PA + raw LP</option>
              <option value="zscore">Z-score scaling</option>
              <option value="minmax">Min-Max scaling</option>
            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="text-sm font-semibold text-blue-900 mb-2">What this page answers</div>
          <div className="text-sm text-blue-800 leading-6 space-y-2">
            <p>Does PA+LP keep a more informative backbone than PA or LP alone?</p>
            <p>Do PA and LP select different high-score and low-score extremes?</p>
            <p>What nodes and edges are shared, unique, gained, or lost when features are combined?</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {result ? (
        <>
          <div className="grid md:grid-cols-4 gap-4">
            <StatCard label="Dataset" value={result.dataset_label} sub={`${result.original_graph.nodes.length} nodes · ${result.original_graph.links.length} edges`} />
            <StatCard label="Backbone %" value={String(result.contamination)} sub="Top percentage used for all three cases" />
            <StatCard label="Scaling" value={result.scaling_mode} sub="Applied only to PA+LP" />
            <StatCard label="Feature pair" value="PA + LP" sub={result.feature_columns.join(' + ')} />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <div className="text-lg font-bold text-navy">Structural metrics comparison</div>
                <div className="text-sm text-gray-500 mt-1">All three backbones were extracted under the same anomaly-selection setting.</div>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100">
                    <th className="py-3 pr-3">Case</th>
                    <th className="py-3 pr-3">Flagged edges</th>
                    <th className="py-3 pr-3">Edge fraction</th>
                    <th className="py-3 pr-3">Node fraction</th>
                    <th className="py-3 pr-3">Reachability</th>
                    <th className="py-3 pr-3">Components</th>
                  </tr>
                </thead>
                <tbody>
                  {methodCards.map((entry) => (
                    <tr key={entry.method_id} className="border-b border-gray-50 last:border-b-0 text-gray-700">
                      <td className="py-3 pr-3"><MethodBadge id={entry.method_id} /> <span className="ml-2 font-medium">{entry.label}</span></td>
                      <td className="py-3 pr-3">{entry.metrics.flagged_edges}</td>
                      <td className="py-3 pr-3">{entry.metrics.edge_fraction.toFixed(4)}</td>
                      <td className="py-3 pr-3">{entry.metrics.node_fraction.toFixed(4)}</td>
                      <td className="py-3 pr-3">{entry.metrics.reachability.toFixed(4)}</td>
                      <td className="py-3 pr-3">{entry.metrics.connected_components}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <MultiFeatureCompositionVisual profile={result.multi_feature_profile} />

          <div className="space-y-5">
            <div className="grid xl:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                <StatCard
                  label="PA selected in top 10%"
                  value={`${result.cases.pa.extremes?.selection_balance.top_10_pct ?? 0}%`}
                  sub={`${result.cases.pa.extremes?.selection_balance.top_10_count ?? 0} of ${result.cases.pa.extremes?.selection_balance.selected_total ?? 0} PA edges`}
                />

                <StatCard
                  label="PA selected in bottom 10%"
                  value={`${result.cases.pa.extremes?.selection_balance.bottom_10_pct ?? 0}%`}
                  sub={`${result.cases.pa.extremes?.selection_balance.bottom_10_count ?? 0} of ${result.cases.pa.extremes?.selection_balance.selected_total ?? 0} PA edges`}
                />

                <StatCard
                  label="PA selected in middle 80%"
                  value={`${result.cases.pa.extremes?.selection_balance.middle_80_pct ?? 0}%`}
                  sub={`${result.cases.pa.extremes?.selection_balance.middle_80_count ?? 0} of ${result.cases.pa.extremes?.selection_balance.selected_total ?? 0} PA edges`}
                />
              </div>

              <ExtremeTable title="PA highest-score edges" rows={result.cases.pa.extremes?.highest ?? []} primaryMethod="pa" />
              <ExtremeTable title="PA lowest-score edges" rows={result.cases.pa.extremes?.lowest ?? []} primaryMethod="pa" />
            </div>

            <div className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <StatCard
                    label="LP selected in top 10%"
                    value={`${result.cases.lp.extremes?.selection_balance.top_10_pct ?? 0}%`}
                    sub={`${result.cases.lp.extremes?.selection_balance.top_10_count ?? 0} of ${result.cases.lp.extremes?.selection_balance.selected_total ?? 0} LP edges`}
                  />

                  <StatCard
                    label="LP selected in bottom 10%"
                    value={`${result.cases.lp.extremes?.selection_balance.bottom_10_pct ?? 0}%`}
                    sub={`${result.cases.lp.extremes?.selection_balance.bottom_10_count ?? 0} of ${result.cases.lp.extremes?.selection_balance.selected_total ?? 0} LP edges`}
                  />

                  <StatCard
                    label="LP selected in middle 80%"
                    value={`${result.cases.lp.extremes?.selection_balance.middle_80_pct ?? 0}%`}
                    sub={`${result.cases.lp.extremes?.selection_balance.middle_80_count ?? 0} of ${result.cases.lp.extremes?.selection_balance.selected_total ?? 0} LP edges`}
                  />
              </div>
              <ExtremeTable title="LP highest-score edges" rows={result.cases.lp.extremes?.highest ?? []} primaryMethod="lp" />
              <ExtremeTable title="LP lowest-score edges" rows={result.cases.lp.extremes?.lowest ?? []} primaryMethod="lp" />
            </div>
            </div>
          </div>

          <ScatterPlot points={result.scatter.points} quadrantCounts={result.scatter.quadrant_counts} />

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div>
              <div className="text-lg font-bold text-navy">Backbone visual comparison</div>
              <div className="text-sm text-gray-500 mt-1">All panels use the same original layout. Each backbone view keeps the full graph faintly in the background and highlights the selected structure in color.</div>
            </div>
            <div className="grid xl:grid-cols-2 gap-5">
              <MultiFeatureGraphPanel title="Original graph" graph={result.original_graph} showOriginal accentColor="#2563EB" />
              <MultiFeatureGraphPanel title="PA backbone" graph={result.original_graph} selectedEdgeKeys={result.cases.pa.selected_edge_keys} accentColor={METHOD_MAP.pa?.color ?? '#3C3489'} />
              <MultiFeatureGraphPanel title="LP backbone" graph={result.original_graph} selectedEdgeKeys={result.cases.lp.selected_edge_keys} accentColor={METHOD_MAP.lp?.color ?? '#993C1D'} />
              <MultiFeatureGraphPanel title="PA + LP backbone" graph={result.original_graph} selectedEdgeKeys={result.cases.pa_lp.selected_edge_keys} accentColor={METHOD_MAP.pa_lp?.color ?? '#0F766E'} />
            </div>
          </div>

          <div className="grid xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-lg font-bold text-navy mb-4">Overlap and difference analysis</div>
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="py-2 pr-3">Comparison</th>
                      <th className="py-2 pr-3">Edge Jaccard</th>
                      <th className="py-2 pr-3">Node Jaccard</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-50 text-gray-700"><td className="py-2 pr-3">PA vs LP</td><td className="py-2 pr-3">{result.overlap.edges.pairwise_jaccard.pa_vs_lp.toFixed(4)}</td><td className="py-2 pr-3">{result.overlap.nodes.pairwise_jaccard.pa_vs_lp.toFixed(4)}</td></tr>
                    <tr className="border-b border-gray-50 text-gray-700"><td className="py-2 pr-3">PA vs PA+LP</td><td className="py-2 pr-3">{result.overlap.edges.pairwise_jaccard.pa_vs_pa_lp.toFixed(4)}</td><td className="py-2 pr-3">{result.overlap.nodes.pairwise_jaccard.pa_vs_pa_lp.toFixed(4)}</td></tr>
                    <tr className="text-gray-700"><td className="py-2 pr-3">LP vs PA+LP</td><td className="py-2 pr-3">{result.overlap.edges.pairwise_jaccard.lp_vs_pa_lp.toFixed(4)}</td><td className="py-2 pr-3">{result.overlap.nodes.pairwise_jaccard.lp_vs_pa_lp.toFixed(4)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-lg font-bold text-navy mb-4">Common and unique structure</div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-gray-100 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Edges</div>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div>Common to all: <strong>{result.overlap.edges.common_to_all.count}</strong></div>
                    <div>Unique to PA: <strong>{result.overlap.edges.unique.pa.count}</strong></div>
                    <div>Unique to LP: <strong>{result.overlap.edges.unique.lp.count}</strong></div>
                    <div>Unique to PA+LP: <strong>{result.overlap.edges.unique.pa_lp.count}</strong></div>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Nodes</div>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div>Common to all: <strong>{result.overlap.nodes.common_to_all.count}</strong></div>
                    <div>Unique to PA: <strong>{result.overlap.nodes.unique.pa.count}</strong></div>
                    <div>Unique to LP: <strong>{result.overlap.nodes.unique.lp.count}</strong></div>
                    <div>Unique to PA+LP: <strong>{result.overlap.nodes.unique.pa_lp.count}</strong></div>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 leading-6">
                {result.interpretation}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
