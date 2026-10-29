import React, { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { downloadContaminationExcel, fetchScoreStatus, runContaminationExperiment, useDatasets } from '../../api/client'
import { METHODS } from '../../constants/methods'
import { useWorkflowStore } from '../../store/workflowStore'
import {
  makeContaminationHistoryKey,
  useContaminationLabStore,
} from '../../store/contaminationLabStore'
import type {
  ContaminationExperimentResponse,
  ContaminationRunResult,
  ContaminationScoreSource,
  MethodId,
  PreprocessingMode,
  ScoreCacheStatusResponse,
} from '../../types'
import { Button } from '../ui'
import PaperExportButton from '../export/PaperExportButton'
import ScoreInspectorSection from '../lab/ScoreInspectorSection'
import ContaminationGraphDiffPanel from './ContaminationGraphDiffPanel'
import MultiFeatureNoveltyCard, {
  makeNoveltyExportRow, NOVELTY_CSV_COLUMNS, downloadNoveltyCsv, noveltySafeFilename,
  type NoveltyExportRow,
} from './MultiFeatureNoveltyCard'

// Match Wizard Step 7 exactly: these are its complete registry metrics and
// display semantics (deviation for transitivity/clustering, value for others).
const WIZARD_METRIC_COLUMNS = [
  { key: 'edge_fraction', label: 'Edge percentage', display: 'value' },
  { key: 'node_fraction', label: 'Node percentage', display: 'value' },
  { key: 'reachability', label: 'Reachability', display: 'value' },
  { key: 'num_components', label: 'Number of components', display: 'value' },
  { key: 'transitivity', label: 'Transitivity deviation', display: 'deviation' },
  { key: 'avg_clustering', label: 'Avg clustering deviation', display: 'deviation' },
  { key: 'degree_entropy', label: 'Degree entropy', display: 'value' },
  { key: 'weight_entropy', label: 'Weight entropy', display: 'value' },
  { key: 'avg_path_length', label: 'Avg path length', display: 'value' },
] as const

// The Excel schema is derived from the actual Multi-Feature CSV headers: no drift.
const NOVELTY_EXPORT_COLUMNS: Array<{ key: string; label: string; format?: 'decimal' | 'integer' | 'percent' }> =
  NOVELTY_CSV_COLUMNS.map((key) => ({
    key,
    label: key,
    format: (key === 'novel_edges' || key === 'multi_edges' ? 'integer' : 'decimal') as 'integer' | 'decimal',
  }))

const METHOD_OPTIONS = METHODS.filter((method) => ['pa', 'lp', 'pa_lp'].includes(method.id))

const PREPROCESSING_OPTIONS: { id: PreprocessingMode; label: string }[] = [
  { id: 'none', label: 'Raw scores (default)' },
  { id: 'log', label: 'Log' },
  { id: 'minmax', label: 'Min-max' },
  { id: 'zscore', label: 'Z-score' },
  { id: 'log_minmax', label: 'Log + Min-max' },
]

const SCORE_SOURCE_OPTIONS: { id: ContaminationScoreSource; label: string; description: string }[] = [
  {
    id: 'auto',
    label: 'Auto reuse saved scores',
    description: 'Checks the dataset-level cache first. Missing scores are computed once and then saved for future runs.',
  },
  {
    id: 'session_scores',
    label: 'Use current session score file',
    description: 'Reuses the score CSV already generated inside your current wizard session.',
  },
  {
    id: 'recompute',
    label: 'Force recompute',
    description: 'Recalculates the score from scratch and replaces the saved dataset-level score cache.',
  },
]

const DEFAULT_CONTAMINATION_LIST = ['0.05', '0.10', '0.15', '0.20', '0.25', '0.30', '0.40', '0.50', '0.75', '1.00']
const ORIGINAL_BASELINE_VALUE = '__original__'
const ORIGINAL_BASELINE_LABEL = 'Original graph'

type DatasetOption = {
  id: string
  label: string
  isCustom: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatNumber(value: number, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'
}

function normalizeToken(token: string) {
  const trimmed = token.trim()
  if (!trimmed) return null
  const numeric = Number(trimmed)
  if (Number.isNaN(numeric) || !(numeric > 0 && numeric <= 1)) return null
  return numeric.toFixed(2)
}

function jaccard(a: string[], b: string[]) {
  const left = new Set(a)
  const right = new Set(b)
  const union = new Set([...left, ...right])
  if (union.size === 0) return 1
  let intersection = 0
  left.forEach((item) => {
    if (right.has(item)) intersection += 1
  })
  return intersection / union.size
}

function diffEdgeSets(previous: string[], current: string[]) {
  const prev = new Set(previous)
  const next = new Set(current)

  let kept = 0
  let added = 0
  let removed = 0

  next.forEach((item) => {
    if (prev.has(item)) kept += 1
    else added += 1
  })

  prev.forEach((item) => {
    if (!next.has(item)) removed += 1
  })

  return { kept, added, removed }
}

function methodColor(methodId: string) {
  return METHOD_OPTIONS.find((method) => method.id === methodId)?.color ?? '#0F6E56'
}

function ExperimentMiniStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-navy">{value}</div>
      {sub ? <div className="text-xs text-gray-400 mt-1">{sub}</div> : null}
    </div>
  )
}

export default function ContaminationExperimentPanel() {
  const { data: datasets = [] } = useDatasets()
  const { sessionId, datasetId: wizardDatasetId, isCustomDataset } = useWorkflowStore()
  const { history, addExperiment, clearHistory } = useContaminationLabStore()

  const datasetOptions = useMemo<DatasetOption[]>(() => {
    const options: DatasetOption[] = datasets.map((dataset) => ({
      id: dataset.id,
      label: dataset.filename,
      isCustom: false,
    }))

    if (wizardDatasetId) {
      const alreadyIncluded = options.some((option) => option.id === wizardDatasetId)
      if (!alreadyIncluded) {
        options.unshift({
          id: wizardDatasetId,
          label: isCustomDataset ? `Current uploaded dataset (${wizardDatasetId})` : `${wizardDatasetId}.csv`,
          isCustom: isCustomDataset,
        })
      }
    }

    return options
  }, [datasets, wizardDatasetId, isCustomDataset])

  const [datasetSelection, setDatasetSelection] = useState<DatasetOption | null>(
    datasetOptions[0] ?? null
  )
  const [methodId, setMethodId] = useState<MethodId>('pa_lp')
  const [scoreSource, setScoreSource] = useState<ContaminationScoreSource>('auto')
  const [cacheStatus, setCacheStatus] = useState<ScoreCacheStatusResponse | null>(null)
  const [preprocessingMode, setPreprocessingMode] = useState<PreprocessingMode>('none')

  const [draftValue, setDraftValue] = useState('0.10')
  const [minValue, setMinValue] = useState('0.05')
  const [maxValue, setMaxValue] = useState('1.00')
  const [stepValue, setStepValue] = useState('0.05')
  const [contaminationList, setContaminationList] = useState<string[]>(DEFAULT_CONTAMINATION_LIST)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedExperimentIndex, setSelectedExperimentIndex] = useState<number>(0)
  const [baselineLabel, setBaselineLabel] = useState<string>('0.05')
  const [selectedRunLabel, setSelectedRunLabel] = useState<string>('0.05')

  useEffect(() => {
    if (!datasetSelection && datasetOptions[0]) {
      setDatasetSelection(datasetOptions[0])
    }
  }, [datasetOptions, datasetSelection])

  useEffect(() => {
    let cancelled = false
    async function loadCacheStatus() {
      if (!datasetSelection) {
        setCacheStatus(null)
        return
      }
      try {
        const data = await fetchScoreStatus(datasetSelection.id, ['pa', 'lp', 'pa_lp'], datasetSelection.isCustom)
        if (!cancelled) setCacheStatus(data)
      } catch {
        if (!cancelled) setCacheStatus(null)
      }
    }
    loadCacheStatus()
    return () => {
      cancelled = true
    }
  }, [datasetSelection])

  const safeStep = useMemo(() => {
    const parsed = Number(stepValue)
    return parsed > 0 ? parsed : 0.01
  }, [stepValue])

  const safeMin = useMemo(() => {
    const parsed = Number(minValue)
    const fallback = 0.01
    return parsed > 0 ? parsed : fallback
  }, [minValue])

  const safeMax = useMemo(() => {
    const parsed = Number(maxValue)
    const capped = parsed > 0 ? Math.min(parsed, 1) : 1
    return capped > safeMin ? capped : safeMin
  }, [maxValue, safeMin])

  const historyKey = datasetSelection
    ? makeContaminationHistoryKey({
        datasetId: datasetSelection.id,
        methodId: String(methodId),
        preprocessingMode,
        scoreSource,
      })
    : null

  const experimentsForKey = historyKey ? history[historyKey] ?? [] : []
  const selectedExperiment = experimentsForKey[selectedExperimentIndex] ?? null
  const activeMethodColor = methodColor(String(methodId))

  useEffect(() => {
    if (selectedExperimentIndex > experimentsForKey.length - 1) {
      setSelectedExperimentIndex(Math.max(0, experimentsForKey.length - 1))
    }
  }, [experimentsForKey.length, selectedExperimentIndex])

  useEffect(() => {
    if (!selectedExperiment) return
    const defaultBaseline = selectedExperiment.runs[0]?.contamination_label ?? '0.05'
    setBaselineLabel(defaultBaseline)
    setSelectedRunLabel(defaultBaseline)
  }, [selectedExperiment])

  const runMap = useMemo(() => {
    if (!selectedExperiment) return {}
    return Object.fromEntries(selectedExperiment.runs.map((run) => [run.contamination_label, run]))
  }, [selectedExperiment])

  const selectedRun = selectedRunLabel ? runMap[selectedRunLabel] : undefined
  const baselineEdgeKeys = useMemo(() => {
    if (!selectedExperiment) return []
    if (baselineLabel === ORIGINAL_BASELINE_VALUE) return selectedExperiment.original_edge_keys
    return runMap[baselineLabel]?.selected_edge_keys ?? []
  }, [baselineLabel, runMap, selectedExperiment])

  const baselineDisplayLabel = baselineLabel === ORIGINAL_BASELINE_VALUE ? ORIGINAL_BASELINE_LABEL : baselineLabel

  const summaryRows = useMemo(() => {
    if (!selectedExperiment) return []
    return selectedExperiment.runs.map((run) => ({
      contamination: run.contamination_label,
      cutoff_rank: run.cutoff_rank,
      flagged_edges: run.flagged_edges,
      edge_fraction: run.edge_fraction,
      node_fraction: run.node_fraction,
      reachability: run.reachability,
      connected_components: run.connected_components,
      jaccard_vs_baseline: jaccard(baselineEdgeKeys, run.selected_edge_keys),
    }))
  }, [selectedExperiment, baselineEdgeKeys])

  const propertyColumns = useMemo(() => [
    { key: 'contamination', label: 'Contamination' },
    { key: 'flagged_edges', label: 'Flagged edges', format: 'integer' as const },
    ...WIZARD_METRIC_COLUMNS.map((metric) => ({
      key: metric.key,
      label: metric.label,
      format: (metric.key === 'num_components' ? 'integer' : 'decimal') as 'integer' | 'decimal',
    })),
  ], [])

  const propertyRows = useMemo(() => {
    if (!selectedExperiment) return []
    return selectedExperiment.runs.map((run) => {
      const row: Record<string, string | number | null> = {
        contamination: run.contamination_label,
        flagged_edges: run.flagged_edges,
      }
      WIZARD_METRIC_COLUMNS.forEach((metric) => {
        const data = run.metrics?.[metric.key]
        row[metric.key] = data ? (metric.display === 'deviation' ? data.deviation : data.value) : null
      })
      return row
    })
  }, [selectedExperiment])

  // Same six fields as Multi-Feature Study; one row per requested contamination.
  // "retention" is the realized edge fraction (including ceil-to-next-edge),
  // exactly as it is in Multi-Feature Study's one-run CSV.
  const noveltyRows = useMemo<NoveltyExportRow[]>(() => {
    if (!selectedExperiment || selectedExperiment.method_id !== 'pa_lp') return []
    return selectedExperiment.runs.filter((run) => Boolean(run.novelty)).map((run) =>
      makeNoveltyExportRow(selectedExperiment.dataset_label, run.edge_fraction, {
        value: run.novelty!.novelty_fraction,
        novel_edges: run.novelty!.novel_edges,
        multi_edges: run.novelty!.pa_lp_edges,
      }),
    )
  }, [selectedExperiment])

  const selectedNoveltyRun = selectedRun?.novelty ? selectedRun : selectedExperiment?.runs.find((run) => Boolean(run.novelty))
  const noveltyChartData = (selectedExperiment?.runs ?? []).filter((run) => Boolean(run.novelty)).map((run) => ({
    contamination: run.contamination_label,
    novelty_percent: run.novelty!.novelty_fraction === null ? null : run.novelty!.novelty_fraction! * 100,
    novel_edges: run.novelty!.novel_edges,
  }))

  function exportNoveltyCsvAll() {
    if (!selectedExperiment || !noveltyRows.length) return
    downloadNoveltyCsv(`${noveltySafeFilename(selectedExperiment.dataset_id)}_multifeature_novelty_all_contaminations.csv`, noveltyRows)
  }

  const [exporting, setExporting] = useState<'properties' | 'novelty' | null>(null)
  async function exportExcel(type: 'properties' | 'novelty') {
    if (!selectedExperiment) return
    setExporting(type)
    setError(null)
    try {
      await downloadContaminationExcel({
        title: type === 'properties' ? 'Full Wizard Evaluation by Contamination' : 'Multi-Feature Novelty (Nρ) by Contamination',
        datasetLabel: selectedExperiment.dataset_label,
        methodLabel: selectedExperiment.method_label,
        preprocessing: selectedExperiment.preprocessing_used,
        filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-contamination-${type}`,
        columns: type === 'properties' ? propertyColumns : [...NOVELTY_EXPORT_COLUMNS],
        rows: type === 'properties' ? propertyRows.map((row) => ({ ...row, contamination: Number(row.contamination) })) : noveltyRows,
      })
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Excel export failed.')
    } finally {
      setExporting(null)
    }
  }

  const deltaRows = useMemo(() => {
    if (!selectedExperiment) return []
    return selectedExperiment.runs.slice(1).map((run, index) => {
      const previous = selectedExperiment.runs[index]
      const delta = diffEdgeSets(previous.selected_edge_keys, run.selected_edge_keys)
      return {
        transition: `${previous.contamination_label} → ${run.contamination_label}`,
        added: delta.added,
        removed: delta.removed,
        kept: delta.kept,
      }
    })
  }, [selectedExperiment])

  function commitDraft() {
    const parsed = Number(draftValue)
    if (Number.isNaN(parsed)) {
      setDraftValue('0.10')
      return
    }
    const clamped = clamp(parsed, safeMin, safeMax)
    setDraftValue(clamped.toFixed(2))
  }

  function addManualValue() {
    commitDraft()
    const token = normalizeToken(draftValue)
    if (!token) {
      setError('Backbone percentage must be a number in the range (0, 1].')
      return
    }
    setError(null)
    setContaminationList((current) => {
      if (current.includes(token)) return current
      return [...current, token].sort((left, right) => {
        return Number(left) - Number(right)
      })
    })
  }

  function fillRange() {
    const values: string[] = []
    let current = safeMin
    while (current <= safeMax + 1e-9) {
      values.push(current.toFixed(2))
      current += safeStep
    }
    setContaminationList(values)
  }

  function removeToken(token: string) {
    setContaminationList((current) => current.filter((item) => item !== token))
  }

  async function handleRunExperiment() {
    if (!datasetSelection) {
      setError('Choose a dataset first.')
      return
    }

    const normalized = contaminationList
      .map((item) => normalizeToken(item))
      .filter((item): item is string => Boolean(item))

    if (normalized.length === 0) {
      setError('Add at least one backbone percentage value before running the experiment.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await runContaminationExperiment({
        datasetId: datasetSelection.id,
        methodId: String(methodId),
        contaminationValues: normalized,
        preprocessingMode,
        scoreSource,
        sessionId,
        isCustom: datasetSelection.isCustom,
      })

      if (!historyKey) return
      addExperiment(historyKey, response)
      const nextLength = (history[historyKey]?.length ?? 0) + 1
      setSelectedExperimentIndex(nextLength - 1)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Failed to run contamination experiment.')
    } finally {
      setLoading(false)
    }
  }

  const chartData = useMemo(() => {
    if (!selectedExperiment) return []
    return selectedExperiment.runs.map((run) => ({
      contamination: run.contamination_label,
      flagged_edges: run.flagged_edges,
      edge_fraction: run.edge_fraction,
      node_fraction: run.node_fraction,
      reachability: run.reachability,
      connected_components: run.connected_components,
      cutoff_rank: run.cutoff_rank ?? 0,
      jaccard_vs_baseline: jaccard(baselineEdgeKeys, run.selected_edge_keys),
    }))
  }, [selectedExperiment, baselineEdgeKeys])

  const latestExperimentLabel = selectedExperiment
    ? `Experiment ${selectedExperimentIndex + 1} of ${experimentsForKey.length}`
    : 'No experiment run yet'

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-navy">Contamination Comparison Lab</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-4xl">
            Dedicated contamination study for PA, LP, and PA+LP. This is separate from the preprocessing study and uses raw scores as the default baseline.
            Nothing reruns while you adjust controls. You build a contamination list deliberately, then run the full experiment in one shot.
          </p>
        </div>

        <Button onClick={handleRunExperiment} loading={loading}>
          Run experiment
        </Button>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
        <div className="text-sm font-semibold text-blue-900 mb-1">Research direction locked in</div>
        <p className="text-sm text-blue-800 leading-6">
          This page keeps the contamination study separate from preprocessing. Raw PA/LP or PA+LP scores stay the safer default, while contamination is the variable being compared across runs.
        </p>
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

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Method</div>
            <div className="flex flex-wrap gap-2">
              {METHOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setMethodId(option.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    methodId === option.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  style={methodId === option.id ? { backgroundColor: option.color } : {}}
                >
                  {option.short} — {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 mb-3">
              Saved score status for this dataset: <strong>PA</strong> {cacheStatus?.methods?.pa?.status ?? 'missing'}, <strong>LP</strong> {cacheStatus?.methods?.lp?.status ?? 'missing'}, <strong>PA+LP</strong> {cacheStatus?.methods?.pa_lp?.status ?? 'missing'}.
            </div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Score source</div>
            <div className="grid md:grid-cols-3 gap-3">
              {SCORE_SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setScoreSource(option.id)}
                  className={`text-left rounded-xl border p-4 transition-all ${
                    scoreSource === option.id
                      ? 'border-teal bg-teal/5 ring-1 ring-teal'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-navy">{option.label}</div>
                  <div className="text-xs text-gray-500 mt-1 leading-5">{option.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Preprocessing used</div>
            <select
              value={preprocessingMode}
              onChange={(e) => setPreprocessingMode(e.target.value as PreprocessingMode)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              {PREPROCESSING_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="text-xs text-gray-500 mt-2">
              Default is <strong>Raw scores</strong>. Use other transformations only when you intentionally want a separate check, not as the default contamination study setup.
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-5">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Backbone percentage list builder</div>
            <p className="text-sm text-gray-500 leading-6">
              Contamination values are explicit top percentages of the sorted Isolation Forest anomaly ranking. Example: 0.25 keeps the top 25% most anomalous edges. Adjusting the slider never reruns the model.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min</label>
              <input type="number" value={minValue} onChange={(e) => setMinValue(e.target.value)} step={0.01} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Max</label>
              <input type="number" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} step={0.01} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Step</label>
              <input type="number" value={stepValue} onChange={(e) => setStepValue(e.target.value)} step={0.01} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="range"
                min={safeMin}
                max={safeMax}
                step={safeStep}
                value={clamp(Number(draftValue) || 0.1, safeMin, safeMax)}
                onChange={(e) => setDraftValue(Number(e.target.value).toFixed(2))}
                className="w-full accent-teal"
              />
              <div className="w-20 rounded-xl border border-gray-200 px-3 py-2 text-sm text-center font-semibold text-navy">
                {draftValue}
              </div>
            </div>
            <div className="text-xs text-gray-500">Draft backbone percentage shown exactly before you add it to the experiment list.</div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={addManualValue}>Add backbone %</Button>
            <Button variant="secondary" onClick={fillRange}>Fill range</Button>
            <Button variant="secondary" onClick={() => setContaminationList(DEFAULT_CONTAMINATION_LIST)}>Reset list</Button>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Current backbone percentages</div>
            <div className="flex flex-wrap gap-2">
              {contaminationList.map((token) => (
                <span key={token} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700">
                  {token}
                  <button onClick={() => removeToken(token)} className="text-gray-400 hover:text-gray-700">×</button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-coral/30 bg-coral-bg px-4 py-3 text-sm text-coral">
          {error}
        </div>
      ) : null}

      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold text-navy">Experiment history for this method setup</div>
            <div className="text-xs text-gray-500 mt-1">Stored per dataset + method + preprocessing + score source, not as a single previous snapshot.</div>
          </div>

          {historyKey ? (
            <Button variant="secondary" onClick={() => clearHistory(historyKey)} disabled={experimentsForKey.length === 0}>
              Clear history for this setup
            </Button>
          ) : null}
        </div>

        {experimentsForKey.length === 0 ? (
          <div className="text-sm text-gray-500">No contamination experiment has been run yet for the current setup.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {experimentsForKey.map((experiment, index) => (
              <button
                key={`${index}-${experiment.run_count}`}
                onClick={() => setSelectedExperimentIndex(index)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                  index === selectedExperimentIndex
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={index === selectedExperimentIndex ? { backgroundColor: activeMethodColor } : {}}
              >
                Experiment {index + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedExperiment ? (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <ExperimentMiniStat label="Dataset" value={selectedExperiment.dataset_label} />
            <ExperimentMiniStat label="Method" value={selectedExperiment.method_label} />
            <ExperimentMiniStat label="Score source" value={selectedExperiment.score_source_used ?? selectedExperiment.score_source} />
            <ExperimentMiniStat label="Preprocessing" value={selectedExperiment.preprocessing_used} sub="raw is the default baseline" />
            <ExperimentMiniStat label="History selection" value={latestExperimentLabel} />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <div className="text-sm font-semibold text-navy">Comparison controls</div>
                <div className="text-xs text-gray-500 mt-1">Choose the baseline for Jaccard comparison and the run to inspect in detail.</div>
              </div>

              <div className="flex flex-wrap gap-3">
                <select value={baselineLabel} onChange={(e) => setBaselineLabel(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
                  <option value={ORIGINAL_BASELINE_VALUE}>Baseline: {ORIGINAL_BASELINE_LABEL}</option>
                  {selectedExperiment.runs.map((run) => (
                    <option key={`baseline-${run.contamination_label}`} value={run.contamination_label}>
                      Baseline: {run.contamination_label}
                    </option>
                  ))}
                </select>

                <select value={selectedRunLabel} onChange={(e) => setSelectedRunLabel(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
                  {selectedExperiment.runs.map((run) => (
                    <option key={`detail-${run.contamination_label}`} value={run.contamination_label}>
                      Detail: {run.contamination_label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end mb-3">
              <PaperExportButton config={{ figureType: 'table', title: 'Contamination summary table', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-contamination-summary`, payload: { title: 'Contamination summary table', subtitle: `Baseline: ${baselineDisplayLabel}`, columns: [
                { key: 'Backbone %', label: 'Backbone %' },
                { key: 'Cutoff rank', label: 'Cutoff rank' },
                { key: 'Flagged edges', label: 'Flagged edges' },
                { key: 'Edge fraction', label: 'Edge fraction' },
                { key: 'Node fraction', label: 'Node fraction' },
                { key: 'Reachability', label: 'Reachability' },
                { key: 'Connected components', label: 'Connected components' },
                { key: 'Jaccard vs baseline', label: 'Jaccard vs baseline' },
              ], rows: summaryRows.map((row) => ({ 'Backbone %': row.contamination, 'Cutoff rank': row.cutoff_rank ?? '—', 'Flagged edges': row.flagged_edges, 'Edge fraction': formatNumber(row.edge_fraction, 4), 'Node fraction': formatNumber(row.node_fraction, 4), 'Reachability': formatNumber(row.reachability, 4), 'Connected components': row.connected_components, 'Jaccard vs baseline': formatNumber(row.jaccard_vs_baseline, 4) })) } }} />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="py-2 pr-4">Backbone %</th>
                    <th className="py-2 pr-4">Cutoff rank</th>
                    <th className="py-2 pr-4">Flagged edges</th>
                    <th className="py-2 pr-4">Edge fraction</th>
                    <th className="py-2 pr-4">Node fraction</th>
                    <th className="py-2 pr-4">Reachability</th>
                    <th className="py-2 pr-4">Connected components</th>
                    <th className="py-2 pr-4">Jaccard vs baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((row) => (
                    <tr key={row.contamination} className="border-b border-gray-50 text-gray-700">
                      <td className="py-3 pr-4 font-semibold text-navy">{row.contamination}</td>
                      <td className="py-3 pr-4">{row.cutoff_rank ?? '—'}</td>
                      <td className="py-3 pr-4">{row.flagged_edges}</td>
                      <td className="py-3 pr-4">{formatNumber(row.edge_fraction, 4)}</td>
                      <td className="py-3 pr-4">{formatNumber(row.node_fraction, 4)}</td>
                      <td className="py-3 pr-4">{formatNumber(row.reachability, 4)}</td>
                      <td className="py-3 pr-4">{row.connected_components}</td>
                      <td className="py-3 pr-4">{formatNumber(row.jaccard_vs_baseline, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Full Wizard Step 7 property registry for every selected contamination. */}
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div>
                <h4 className="text-lg font-bold text-navy">All Wizard evaluation properties by contamination</h4>
                <p className="text-xs text-gray-500 mt-1 max-w-3xl">
                  Each row is one backbone percentage. Transitivity and clustering show signed relative deviation from the original graph,
                  while other properties match the values displayed in Wizard Step 7. The same graph metrics are computed for PA, LP, and PA+LP.
                </p>
              </div>
              <Button variant="secondary" onClick={() => exportExcel('properties')} loading={exporting === 'properties'} disabled={propertyRows.length === 0 || selectedExperiment.runs.some((run) => !run.metrics)}>
                Download properties Excel (.xlsx)
              </Button>
            </div>
            {selectedExperiment.runs.some((run) => !run.metrics) ? (
              <p className="text-xs text-amber-700">This experiment was created before full metrics were added. Run the experiment again to populate this table.</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="min-w-max w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    {propertyColumns.map((column) => (
                      <th key={column.key} className="text-left align-bottom px-3 py-3 font-semibold min-w-[110px] whitespace-normal">{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {propertyRows.map((row, index) => (
                    <tr key={String(row.contamination)} className={`border-b border-gray-100 ${index % 2 ? 'bg-gray-50/50' : ''}`}>
                      {propertyColumns.map((column) => (
                        <td key={column.key} className={`px-3 py-3 tabular-nums ${column.key === 'contamination' ? 'font-semibold text-teal' : 'text-gray-700'}`}>
                          {row[column.key] === null || row[column.key] === undefined ? '—'
                            : typeof row[column.key] === 'number'
                              ? (column.format === 'integer' ? String(Math.round(row[column.key] as number)) : formatNumber(row[column.key] as number))
                              : row[column.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedExperiment.method_id === 'pa_lp' ? (
            <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap justify-between items-start gap-4">
                <div>
                  <h4 className="text-lg font-bold text-navy">Multi-Feature Novelty (Nρ) by contamination</h4>
                  <p className="text-xs text-gray-500 mt-1 max-w-3xl">
                    This is the same novelty calculation, explanatory card, and six-column CSV format as the Multi-Feature Study.
                    Each row is a separate contamination value. The retention column is the actual retained edge fraction,
                    which may differ slightly from the requested contamination due to whole-edge rounding.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={exportNoveltyCsvAll} disabled={noveltyRows.length === 0}>
                    Export all novelty CSV
                  </Button>
                  <Button variant="secondary" onClick={() => exportExcel('novelty')} loading={exporting === 'novelty'} disabled={noveltyRows.length === 0}>
                    Download novelty Excel (.xlsx)
                  </Button>
                </div>
              </div>
              {noveltyRows.length === 0 ? (
                <p className="text-sm text-gray-500">Run the PA+LP contamination experiment again to calculate the same Multi-Feature novelty for every value.</p>
              ) : (
                <>
                  {selectedNoveltyRun?.novelty ? (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-semibold text-gray-700">Multi-Feature Study novelty card</p>
                        <label className="text-sm text-gray-600 flex items-center gap-2">
                          Contamination
                          <select
                            value={selectedNoveltyRun.contamination_label}
                            onChange={(event) => setSelectedRunLabel(event.target.value)}
                            className="border border-gray-200 rounded-lg bg-white px-3 py-1.5 text-sm text-navy"
                          >
                            {selectedExperiment.runs.filter((run) => Boolean(run.novelty)).map((run) => (
                              <option value={run.contamination_label} key={run.contamination_label}>{run.contamination_label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <MultiFeatureNoveltyCard
                        novelty={{
                          value: selectedNoveltyRun.novelty.novelty_fraction,
                          novel_edges: selectedNoveltyRun.novelty.novel_edges,
                          multi_edges: selectedNoveltyRun.novelty.pa_lp_edges,
                        }}
                        datasetId={selectedExperiment.dataset_id}
                        datasetLabel={selectedExperiment.dataset_label}
                        retention={selectedNoveltyRun.edge_fraction}
                        contextLabel={`Requested contamination: ${selectedNoveltyRun.contamination_label}`}
                        filename={`${noveltySafeFilename(selectedExperiment.dataset_id)}_multifeature_novelty_${selectedNoveltyRun.contamination_label}.csv`}
                      />
                    </div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="min-w-max w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                          <th className="text-left align-bottom px-3 py-3 font-semibold">Contamination</th>
                          {NOVELTY_EXPORT_COLUMNS.map((col) => (
                            <th key={col.key} className="text-left align-bottom px-3 py-3 font-semibold min-w-[100px] whitespace-normal">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {noveltyRows.map((row, index) => (
                          <tr key={index} className={`border-b border-gray-100 ${index % 2 ? 'bg-gray-50/50' : ''}`}>
                            <td className="px-3 py-3 font-semibold text-teal tabular-nums">{selectedExperiment.runs[index]?.contamination_label ?? '—'}</td>
                            {NOVELTY_EXPORT_COLUMNS.map((col) => {
                              const value = row[col.key as keyof NoveltyExportRow]
                              return (
                                <td key={col.key} className={`px-3 py-3 tabular-nums ${col.key === 'novelty_percent' ? 'font-semibold text-teal' : 'text-gray-700'}`}>
                                  {value === null ? '—' : typeof value === 'number' ? (col.format === 'integer' ? String(value) : formatNumber(value, col.key === 'novelty_percent' ? 2 : 6)) : value}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid xl:grid-cols-2 gap-5">
                    <div>
                      <h5 className="text-sm font-semibold text-navy mb-2">Novelty (%) across contamination</h5>
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={noveltyChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="contamination" /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                          <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                          <Line dataKey="novelty_percent" name="Novelty (%)" type="monotone" stroke="#0F766E" strokeWidth={2} dot />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <h5 className="text-sm font-semibold text-navy mb-2">Novel PA+LP edges across contamination</h5>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={noveltyChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="contamination" /><YAxis allowDecimals={false} /><Tooltip />
                          <Bar dataKey="novel_edges" name="Novel PA+LP edges" fill="#0F766E" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              )}
            </section>
          ) : null}

          <div className="grid xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">1. Backbone % vs backbone size</div><PaperExportButton config={{ figureType: 'line', title: 'Backbone % vs backbone size', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-backbone-pct-vs-backbone-size`, payload: { title: 'Backbone % vs backbone size', subtitle: `Method: ${selectedExperiment.method_label} · baseline: ${baselineDisplayLabel}`, rows: chartData, x_key: 'contamination', x_label: 'Backbone size / edge fraction', y_label: 'Backbone %', series: [{ key: 'flagged_edges', label: 'Flagged edges', color: activeMethodColor }, { key: 'edge_fraction', label: 'Edge fraction', color: '#111827' }] } } } /></div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="contamination" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="flagged_edges" name="Flagged edges" stroke={activeMethodColor} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="edge_fraction" name="Edge fraction" stroke="#111827" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">2. Backbone % vs node fraction</div><PaperExportButton config={{ figureType: 'line', title: 'Backbone % vs node fraction', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-backbone-pct-vs-node-fraction`, payload: { title: 'Backbone % vs node fraction', subtitle: `Method: ${selectedExperiment.method_label} · baseline: ${baselineDisplayLabel}`, rows: chartData, x_key: 'contamination', x_label: 'Node fraction', y_label: 'Backbone %', series: [{ key: 'node_fraction', label: 'Node fraction', color: activeMethodColor }] } } } /></div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="contamination" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="node_fraction" name="Node fraction" stroke={activeMethodColor} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">3. Backbone % vs reachability</div><PaperExportButton config={{ figureType: 'line', title: 'Backbone % vs reachability', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-backbone-pct-vs-reachability`, payload: { title: 'Backbone % vs reachability', subtitle: `Method: ${selectedExperiment.method_label} · baseline: ${baselineDisplayLabel}`, rows: chartData, x_key: 'contamination', x_label: 'Reachability', y_label: 'Backbone %', series: [{ key: 'reachability', label: 'Reachability', color: activeMethodColor }] } } } /></div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="contamination" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="reachability" name="Reachability" stroke={activeMethodColor} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">4. Backbone % vs connected components</div><PaperExportButton config={{ figureType: 'line', title: 'Backbone % vs connected components', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-backbone-pct-vs-connected-components`, payload: { title: 'Backbone % vs connected components', subtitle: `Method: ${selectedExperiment.method_label} · baseline: ${baselineDisplayLabel}`, rows: chartData, x_key: 'contamination', x_label: 'Connected components', y_label: 'Backbone %', series: [{ key: 'connected_components', label: 'Connected components', color: activeMethodColor }] } } } /></div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="contamination" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="connected_components" name="Connected components" stroke={activeMethodColor} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">5. Jaccard similarity vs contamination</div><PaperExportButton config={{ figureType: 'line', title: 'Jaccard similarity vs contamination', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-jaccard-similarity-vs-contamination`, payload: { title: 'Jaccard similarity vs contamination', subtitle: `Method: ${selectedExperiment.method_label} · baseline: ${baselineDisplayLabel}`, rows: chartData, x_key: 'contamination', x_label: 'Jaccard similarity', y_label: 'Backbone %', series: [{ key: 'jaccard_vs_baseline', label: 'Jaccard vs baseline', color: activeMethodColor }] } } } /></div>
              <div className="text-xs text-gray-500 mb-3">Baseline: {baselineDisplayLabel}</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="contamination" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 1]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="jaccard_vs_baseline" name="Jaccard vs baseline" stroke={activeMethodColor} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">6. Cutoff rank vs backbone %</div><PaperExportButton config={{ figureType: 'line', title: 'Cutoff rank vs backbone %', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-cutoff-rank-vs-backbone-pct`, payload: { title: 'Cutoff rank vs backbone %', subtitle: `Method: ${selectedExperiment.method_label} · baseline: ${baselineDisplayLabel}`, rows: chartData, x_key: 'contamination', x_label: 'Cutoff rank', y_label: 'Backbone %', series: [{ key: 'cutoff_rank', label: 'Cutoff rank / selected top-k', color: activeMethodColor }] } } } /></div>
              <div className="text-xs text-gray-500 mb-3">
                The plotted cutoff rank is how deep the app cuts into the sorted anomaly ranking. For 0.25 it keeps roughly the top 25% edges.
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="contamination" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  
                  <Line type="monotone" dataKey="cutoff_rank" name="Cutoff rank / selected top-k" stroke={activeMethodColor} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3"><div className="text-sm font-semibold text-navy">7. Delta chart between consecutive runs</div><PaperExportButton config={{ figureType: 'bar', title: 'Delta chart between consecutive runs', filename: `${selectedExperiment.dataset_id}-${selectedExperiment.method_id}-delta-runs`, payload: { title: 'Delta chart between consecutive runs', subtitle: 'How many edges were kept, added, or removed between consecutive contamination values.', rows: deltaRows, x_key: 'transition', series: [ { key: 'added', label: 'Added edges', color: activeMethodColor }, { key: 'removed', label: 'Removed edges', color: '#BA7517' }, { key: 'kept', label: 'Kept edges', color: '#111827' } ], y_axis_label: 'Edge count' } }} /></div>
            <div className="text-xs text-gray-500 mb-3">This shows whether the next contamination value mostly adds a few edges or actually changes backbone identity.</div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={deltaRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="transition" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="added" name="Added edges" fill={activeMethodColor} />
                <Bar dataKey="removed" name="Removed edges" fill="#BA7517" />
                <Bar dataKey="kept" name="Kept edges" fill="#111827" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {selectedRun ? (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="text-sm font-semibold text-navy mb-2">Detail panel for backbone % {selectedRun.contamination_label}</div>
                <div className="text-xs text-gray-500 leading-6">
                  Selected backbone edges: <strong>{selectedRun.selected_edge_keys.length}</strong> using preprocessing <strong>{selectedRun.preprocessing_used}</strong>. Compare it against <strong>{baselineDisplayLabel}</strong> or switch the baseline selector to compare against the full original graph.
                </div>
              </div>

              <ContaminationGraphDiffPanel
                originalGraph={selectedExperiment.original_graph}
                baselineLabel={baselineDisplayLabel}
                baselineEdgeKeys={baselineEdgeKeys}
                selectedRunLabel={selectedRun.contamination_label}
                selectedEdgeKeys={selectedRun.selected_edge_keys}
                accentColor={activeMethodColor}
              />

              <ScoreInspectorSection inspector={selectedRun.inspector} rows={selectedRun.rows} methodColor={activeMethodColor} previousRun={null} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
