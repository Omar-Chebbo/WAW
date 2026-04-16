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
  ReferenceLine,
} from 'recharts'
import type { AnomalyInspector, ScoreHistogramBin, ScoreStats } from '../../types'

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

function HistogramBlock({
  title,
  bins,
  color,
  xLabel,
}: {
  title: string
  bins: ScoreHistogramBin[]
  color: string
  xLabel: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="text-sm font-semibold text-navy mb-3">{title}</div>
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

export default function ScoreInspectorSection({
  inspector,
  methodColor,
  rows,
  previousRun,
}: Props) {
  const [mainView, setMainView] = useState<MainView>('raw')

  const scoreColumn = inspector.score_column
  const transformedKey = `${scoreColumn}_transformed`
  const scoreSamplesKey = `${scoreColumn}_if_score_samples`
  const decisionKey = `${scoreColumn}_if_decision_function`
  const anomalyKey = `${scoreColumn}_anomaly`
  const rankKey = `${scoreColumn}_if_rank`

  const currentViewMeta = {
    raw: {
      title: 'Raw score',
      description: 'This is the score before preprocessing and before Isolation Forest.',
      stats: inspector.stats.raw,
      hist: inspector.histograms.raw,
      xLabel: 'Raw score',
      valueKey: scoreColumn,
    },
    transformed: {
      title: 'Model input',
      description: 'This is the score after preprocessing. These values are sent into Isolation Forest.',
      stats: inspector.stats.transformed,
      hist: inspector.histograms.transformed,
      xLabel: 'Transformed score',
      valueKey: transformedKey,
    },
    model: {
      title: 'Model output',
      description: 'This view focuses on Isolation Forest output scores and anomaly decisions.',
      stats: inspector.stats.score_samples,
      hist: inspector.histograms.score_samples,
      xLabel: 'score_samples',
      valueKey: scoreSamplesKey,
    },
  } as const

  const current = currentViewMeta[mainView]

  const sortedData = useMemo(() => {
    const copied = [...rows]
    copied.sort((a, b) => Number(a[current.valueKey]) - Number(b[current.valueKey]))
    return copied.map((row, idx) => ({
      idx: idx + 1,
      value: Number(row[current.valueKey]),
      anomaly: Number(row[anomalyKey]) === -1 ? 1 : 0,
    }))
  }, [rows, current.valueKey, anomalyKey])

  const scatterDecisionNormal = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) !== -1)
      .map((r) => ({
        x: Number(r[scoreColumn]),
        y: Number(r[decisionKey]),
      }))
  }, [rows, anomalyKey, scoreColumn, decisionKey])

  const scatterDecisionAnomaly = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) === -1)
      .map((r) => ({
        x: Number(r[scoreColumn]),
        y: Number(r[decisionKey]),
      }))
  }, [rows, anomalyKey, scoreColumn, decisionKey])

  const scatterSamplesNormal = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) !== -1)
      .map((r) => ({
        x: Number(r[scoreColumn]),
        y: Number(r[scoreSamplesKey]),
      }))
  }, [rows, anomalyKey, scoreColumn, scoreSamplesKey])

  const scatterSamplesAnomaly = useMemo(() => {
    return rows
      .filter((r) => Number(r[anomalyKey]) === -1)
      .map((r) => ({
        x: Number(r[scoreColumn]),
        y: Number(r[scoreSamplesKey]),
      }))
  }, [rows, anomalyKey, scoreColumn, scoreSamplesKey])

  const rankedData = useMemo(() => {
    return [...rows]
      .sort((a, b) => Number(a[rankKey]) - Number(b[rankKey]))
      .map((row) => ({
        rank: Number(row[rankKey]),
        scoreSamples: Number(row[scoreSamplesKey]),
        decision: Number(row[decisionKey]),
        anomaly: Number(row[anomalyKey]),
      }))
  }, [rows, rankKey, scoreSamplesKey, decisionKey, anomalyKey])

  const topRows = useMemo(() => {
    return [...rows]
      .sort((a, b) => Number(a[rankKey]) - Number(b[rankKey]))
      .slice(0, 20)
  }, [rows, rankKey])

    const previousModeLabel = 'Top-percentage cut'

  return (
    <div className="space-y-6 mb-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
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
          {formatStats(current.stats).map((item) => (
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
            bins={current.hist}
            color={methodColor}
            xLabel={current.xLabel}
          />

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-sm font-semibold text-navy mb-3">
              Sorted {current.title.toLowerCase()} values
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-sm font-semibold text-navy mb-3">
              Scatter: raw score vs sklearn decision score
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Raw score"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Raw score', position: 'insideBottom', offset: -6, fontSize: 11 }}
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
                <Scatter name="Normal" data={scatterDecisionNormal} fill="#d1d5db" />
                <Scatter name="Anomaly" data={scatterDecisionAnomaly} fill={methodColor} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-sm font-semibold text-navy mb-3">
              Scatter: raw score vs score_samples
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Raw score"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Raw score', position: 'insideBottom', offset: -6, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="score_samples"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'score_samples', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter name="Normal" data={scatterSamplesNormal} fill="#d1d5db" />
                <Scatter name="Anomaly" data={scatterSamplesAnomaly} fill={methodColor} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-sm font-semibold text-navy mb-3">
              Ranked abnormality plot (score_samples scale)
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
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-navy">
              Top 20 most abnormal edges
            </div>
            <div className="text-xs text-gray-500">
              Sorted by abnormality rank
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2 pr-4">Edge</th>
                  <th className="py-2 pr-4">Raw</th>
                  <th className="py-2 pr-4">Transformed</th>
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
                      <td className="py-2 pr-4">{Number(row[scoreColumn]).toFixed(4)}</td>
                      <td className="py-2 pr-4">{Number(row[transformedKey]).toFixed(4)}</td>
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