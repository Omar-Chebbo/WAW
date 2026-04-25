import React, { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { runResearchAnalysis } from '../../api/client'
import { METHODS } from '../../constants/methods'
import { Button } from '../ui'
import PaperExportButton from '../export/PaperExportButton'
import type {
  ResearchAnalysisResponse,
  ResearchNetworkId,
  ResearchTransformId,
  ResearchTransformExperiment,
} from '../../types'

const NETWORK_OPTIONS: Array<{ id: ResearchNetworkId; label: string }> = [
  { id: 'karate', label: "Zachary’s Karate Club" },
  { id: 'lesmis', label: 'Les Misérables' },
]

const METHOD_OPTIONS = METHODS.filter(m => m.id === 'pa' || m.id === 'lp')

const TRANSFORM_ORDER: ResearchTransformId[] = [
  'raw',
  'log',
  'minmax',
  'zscore',
  'log_minmax',
  'log_zscore',
]

function formatTransformName(id?: string | null) {
  if (!id) return '—'
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-navy">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

function transformRowsFromResult(result: ResearchAnalysisResponse | null) {
  if (!result) return []
  return TRANSFORM_ORDER
    .map(id => result.transformation_experiments[id])
    .filter(Boolean) as ResearchTransformExperiment[]
}

export default function ResearchAnalysisPanel() {
  const [networkId, setNetworkId] = useState<ResearchNetworkId>('karate')
  const [methodId, setMethodId] = useState<'pa' | 'lp'>('pa')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResearchAnalysisResponse | null>(null)
  const [activeTransform, setActiveTransform] = useState<ResearchTransformId>('raw')
  const [selectionFraction, setSelectionFraction] = useState(0.10)

  const methodColor =
    METHOD_OPTIONS.find(m => m.id === methodId)?.color ?? '#3C3489'

  async function handleRun() {
    setLoading(true)
    setError(null)

    try {
      const res = await runResearchAnalysis(networkId, methodId, selectionFraction)
      setResult(res)

      const recommended = res.preprocessing_recommendation.selected_transform as ResearchTransformId
      if (res.transformation_experiments[recommended]) {
        setActiveTransform(recommended)
      } else {
        setActiveTransform('raw')
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Research analysis failed.')
    }

    setLoading(false)
  }

  const transformRows = useMemo(
    () => transformRowsFromResult(result),
    [result]
  )

  const rawHistogram = useMemo(() => {
    if (!result) return []
    return result.distribution.histogram.map(bin => ({
      bin: bin.bin_center,
      count: bin.count,
    }))
  }, [result])

  const activeExperiment = result?.transformation_experiments?.[activeTransform]

  const transformedHistogram = useMemo(() => {
    if (!activeExperiment?.transformed_stats) return []
    return activeExperiment.transformed_stats.histogram.map(bin => ({
      bin: bin.bin_center,
      count: bin.count,
    }))
  }, [activeExperiment])

  const backbonePctData = useMemo(() => {
    return transformRows
      .filter(row => !row.error && row.backbone)
      .map(row => ({
        transform: formatTransformName(row.transform_id),
        pct_backbone: row.backbone?.pct_backbone ?? 0,
      }))
  }, [transformRows])

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-bold text-navy">Research Analysis Lab</h3>
          <p className="text-sm text-gray-500 mt-1">
            Explore score distributions, preprocessing choices, anomaly detection,
            and backbone changes for PA and LP on the two benchmark networks.
          </p>
        </div>

        <Button onClick={handleRun} loading={loading}>
          🧪 Run Research Analysis
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Benchmark Network
          </div>
          <div className="flex flex-wrap gap-2">
            {NETWORK_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setNetworkId(opt.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  networkId === opt.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={networkId === opt.id ? { backgroundColor: '#0F6E56' } : {}}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Link Prediction Method
          </div>
          <div className="flex flex-wrap gap-2">
            {METHOD_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setMethodId(opt.id as 'pa' | 'lp')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  methodId === opt.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={methodId === opt.id ? { backgroundColor: opt.color } : {}}
              >
                {opt.short} — {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Backbone percentage for preprocessing comparison
            </div>
            <div className="text-sm text-gray-600 leading-6">
              This value controls how many top-ranked Isolation Forest edges are kept for each transformation.
              Example: <strong>0.25</strong> means top 25% of the anomaly ranking.
            </div>
          </div>

          <div className="min-w-[280px]">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.01}
                max={1}
                step={0.01}
                value={selectionFraction}
                onChange={(e) => setSelectionFraction(Number(e.target.value))}
                className="w-full accent-teal"
              />
              <input
                type="number"
                min={0.01}
                max={1}
                step={0.01}
                value={selectionFraction.toFixed(2)}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  if (!Number.isNaN(value)) {
                    setSelectionFraction(Math.min(1, Math.max(0.01, value)))
                  }
                }}
                className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="text-xs text-gray-400 mt-2">
              Current selection: {(selectionFraction * 100).toFixed(0)}% of edges kept as backbone.
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-coral-bg border border-coral/30 rounded-lg px-4 py-3 text-sm text-coral mb-6">
          ❌ {error}
        </div>
      )}

      {!result && !loading && (
        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-6 text-sm text-gray-500">
          Choose one benchmark network and one method, then run the analysis.
          The panel will show:
          <div className="mt-2 space-y-1">
            <div>• raw score distribution statistics</div>
            <div>• automatic preprocessing recommendation</div>
            <div>• transformation-by-transformation backbone comparison</div>
            <div>• transformed histograms and sample backbone edges</div>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniStat label="Network" value={result.network} />
            <MiniStat label="Method" value={result.method} />
            <MiniStat label="Nodes" value={result.n_nodes} />
            <MiniStat label="Edges" value={result.n_edges} />
            <MiniStat label="Backbone %" value={`${((result.selection_fraction ?? selectionFraction) * 100).toFixed(0)}%`} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniStat label="Mean" value={result.distribution.mean} />
            <MiniStat label="Median" value={result.distribution.median} />
            <MiniStat label="Variance" value={result.distribution.variance} />
            <MiniStat label="Skewness" value={result.distribution.skewness} />
          </div>

          {/* Automatic recommendation */}
          <div className="rounded-2xl border border-purple/20 bg-purple-bg p-5">
            <div className="text-sm font-semibold text-purple mb-2">
              Automatic preprocessing decision
            </div>
            <div className="text-sm text-gray-700 mb-2">
              <strong>Shape class:</strong> {result.preprocessing_recommendation.shape_class}
            </div>
            <div className="text-sm text-gray-700 mb-2">
              <strong>Recommended transform:</strong>{' '}
              {formatTransformName(result.preprocessing_recommendation.selected_transform)}
            </div>
            <div className="text-sm text-gray-600">
              {result.preprocessing_recommendation.reason}
            </div>
          </div>

          {/* Raw distribution + notes */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-semibold text-navy">Raw Score Distribution</div>
                <PaperExportButton config={{ figureType: 'histogram', title: 'Raw score distribution', filename: `${networkId}-${methodId}-raw-distribution`, payload: { title: 'Raw score distribution', subtitle: result.algorithmic_notes.design_tradeoff, bins: result.distribution.histogram.map((bin) => ({ bin_center: bin.bin_center, count: bin.count })), x_label: 'Raw score', y_label: 'Edge count', total_key: 'count', accent_color: methodColor } }} />
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={rawHistogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="bin" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value: number) => [value, 'Edge count']}
                    labelFormatter={(label) => `Score ≈ ${Number(label).toFixed(4)}`}
                  />
                  <Bar dataKey="count" fill={methodColor} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-sm font-semibold text-navy mb-3">
                Algorithmic Notes
              </div>
              <div className="space-y-3 text-sm text-gray-600">
                <div>
                  <strong className="text-gray-700">Computational cost:</strong>{' '}
                  {result.algorithmic_notes.computational_cost}
                </div>
                <div>
                  <strong className="text-gray-700">Runtime classification limits:</strong>{' '}
                  {result.algorithmic_notes.runtime_classification_limitations}
                </div>
                <div>
                  <strong className="text-gray-700">Design tradeoff:</strong>{' '}
                  {result.algorithmic_notes.design_tradeoff}
                </div>
              </div>
            </div>
          </div>

          {/* Transformation selector */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Inspect a specific transformation
            </div>
            <div className="flex flex-wrap gap-2">
              {TRANSFORM_ORDER.map(id => {
                const row = result.transformation_experiments[id]
                const isActive = activeTransform === id

                return (
                  <button
                    key={id}
                    onClick={() => setActiveTransform(id)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                      isActive
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={isActive ? { backgroundColor: methodColor } : {}}
                  >
                    {row?.label ?? formatTransformName(id)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Active transformation details */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-sm font-semibold text-navy mb-2">
                {activeExperiment?.label ?? 'Transformation'}
              </div>
              <div className="text-sm text-gray-600 mb-4">
                {activeExperiment?.description}
              </div>

              {activeExperiment?.error ? (
                <div className="bg-coral-bg border border-coral/30 rounded-lg px-4 py-3 text-sm text-coral">
                  {activeExperiment.error}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <MiniStat
                      label="Transformed mean"
                      value={activeExperiment?.transformed_stats?.mean ?? '—'}
                    />
                    <MiniStat
                      label="Transformed skewness"
                      value={activeExperiment?.transformed_stats?.skewness ?? '—'}
                    />
                    <MiniStat
                      label="Backbone edges"
                      value={activeExperiment?.backbone?.n_backbone ?? '—'}
                    />
                    <MiniStat
                      label="Backbone %"
                      value={
                        activeExperiment?.backbone
                          ? `${activeExperiment.backbone.pct_backbone}%`
                          : '—'
                      }
                    />
                  </div>

                  <div className="flex justify-end mb-3">
                    <PaperExportButton config={{ figureType: 'histogram', title: `${activeExperiment?.label ?? 'Transform'} histogram`, filename: `${networkId}-${methodId}-${activeTransform}-distribution`, payload: { title: `${activeExperiment?.label ?? 'Transform'} histogram`, subtitle: activeExperiment?.description, bins: transformedHistogram.map((bin) => ({ bin_center: bin.bin, count: bin.count })), x_label: 'Transformed score', y_label: 'Edge count', total_key: 'count', accent_color: methodColor } }} />
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={transformedHistogram}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                      <XAxis dataKey="bin" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(value: number) => [value, 'Edge count']}
                        labelFormatter={(label) => `Value ≈ ${Number(label).toFixed(4)}`}
                      />
                      <Bar dataKey="count" fill={methodColor} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-sm font-semibold text-navy mb-3">
                Backbone structure for selected transformation
              </div>

              {activeExperiment?.error ? (
                <div className="text-sm text-gray-500">
                  No backbone summary available because this transformation failed.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <MiniStat
                      label="Components"
                      value={activeExperiment?.backbone?.component_count ?? '—'}
                    />
                    <MiniStat
                      label="Jaccard vs raw"
                      value={activeExperiment?.backbone?.jaccard_vs_raw ?? '—'}
                    />
                    <MiniStat
                      label="Backbone score mean"
                      value={activeExperiment?.backbone?.backbone_score_mean ?? '—'}
                    />
                    <MiniStat
                      label="Normal score mean"
                      value={activeExperiment?.backbone?.normal_score_mean ?? '—'}
                    />
                  </div>

                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Sample extracted edges
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(activeExperiment?.selected_edges ?? []).length === 0 && (
                      <span className="text-sm text-gray-400">No edges listed.</span>
                    )}

                    {(activeExperiment?.selected_edges ?? []).map((edge, idx) => (
                      <span
                        key={`${edge[0]}-${edge[1]}-${idx}`}
                        className="px-2 py-1 rounded-full text-xs font-mono bg-gray-100 text-gray-600"
                      >
                        {edge[0]} — {edge[1]}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Cross-transform comparison */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-navy">Backbone retention across transformations</div>
              <PaperExportButton config={{ figureType: 'bar', title: 'Backbone retention across transformations', filename: `${networkId}-${methodId}-retention-comparison`, payload: { title: 'Backbone retention across transformations', subtitle: 'Percentage of edges retained in the extracted backbone for each preprocessing choice.', rows: backbonePctData.map((row) => ({ transform: row.transform, backbone_pct: row.pct_backbone })), x_key: 'transform', series: [{ key: 'backbone_pct', label: 'Backbone %', color: methodColor }], y_axis_label: 'Backbone %', x_rotation: 0 } }} />
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={backbonePctData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="transform" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value: number) => [`${value}%`, 'Backbone edges']} />
                <Legend />
                <Bar dataKey="pct_backbone" name="Backbone %" fill={methodColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Comparison table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <div className="flex justify-end p-4 pb-0">
              <PaperExportButton config={{ figureType: 'table', title: 'Transformation comparison table', filename: `${networkId}-${methodId}-transform-table`, payload: { title: 'Transformation comparison table', subtitle: 'Backbone summary for each preprocessing option.', columns: [
                { key: 'Transformation', label: 'Transformation' },
                { key: 'Skewness', label: 'Skewness' },
                { key: 'Backbone %', label: 'Backbone %' },
                { key: 'Components', label: 'Components' },
                { key: 'Jaccard vs raw', label: 'Jaccard vs raw' },
                { key: 'Status', label: 'Status' },
              ], rows: transformRows.map((row) => ({ 'Transformation': row.label, 'Skewness': row.transformed_stats?.skewness ?? '—', 'Backbone %': row.backbone ? `${row.backbone.pct_backbone}%` : '—', 'Components': row.backbone?.component_count ?? '—', 'Jaccard vs raw': row.backbone?.jaccard_vs_raw ?? '—', 'Status': row.error ? row.error : 'OK' })) } }} />
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Transformation</th>
                  <th className="text-left px-4 py-3 font-semibold">Skewness</th>
                  <th className="text-left px-4 py-3 font-semibold">Backbone %</th>
                  <th className="text-left px-4 py-3 font-semibold">Components</th>
                  <th className="text-left px-4 py-3 font-semibold">Jaccard vs raw</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {transformRows.map(row => (
                  <tr key={row.transform_id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-medium text-navy">{row.label}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.transformed_stats?.skewness ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.backbone ? `${row.backbone.pct_backbone}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.backbone?.component_count ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.backbone?.jaccard_vs_raw ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.error ? (
                        <span className="text-coral">{row.error}</span>
                      ) : (
                        <span className="text-teal">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-gray-400">
            This panel is meant for your research task: distribution characterization,
            preprocessing strategy, anomaly-detection sensitivity, and backbone change analysis.
          </div>
        </div>
      )}
    </div>
  )
}