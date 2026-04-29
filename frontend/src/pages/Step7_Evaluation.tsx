/**
 * pages/Step7_Evaluation.tsx
 * Computes structural metrics for every backbone and displays
 * results as a table + radar chart.  Exports to CSV.
 */
import React, { useState, useEffect, useMemo } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { useWorkflowStore } from '../store/workflowStore'
import {
  runEvaluation, downloadEvaluationCsv,
  useMetricsList, fetchDistributions,
} from '../api/client'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'

import type { EvaluationReport, DistributionReport } from '../types'
import PaperExportButton from '../components/export/PaperExportButton'

// Deviation → badge colour
function deviationColour(d: number) {
  const abs = Math.abs(d)
  if (abs < 0.1)  return { bg: '#E1F5EE', text: '#0F6E56' }   // ≤ 10% — green
  if (abs < 0.25) return { bg: '#FAEEDA', text: '#BA7517' }   // ≤ 25% — amber
  return            { bg: '#FAECE7', text: '#993C1D' }         // > 25% — coral
}

function DeviationBadge({ d }: { d: number }) {
  const { bg, text } = deviationColour(d)
  const sign = d > 0 ? '+' : ''
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: bg, color: text }}>
      {sign}{(d * 100).toFixed(1)}%
    </span>
  )
}

// Paper Table 2: some metrics show the raw backbone value,
// others show the signed relative deviation from the original.
const METRIC_DISPLAY_TYPE: Record<string, 'value' | 'deviation'> = {
  edge_fraction:   'value',
  node_fraction:   'value',
  reachability:    'value',
  num_components:  'value',
  transitivity:    'deviation',
  avg_clustering:  'deviation',
  degree_entropy:  'value',
  weight_entropy:  'value',
  avg_path_length: 'value',
}

// ── Helper: compute CCDF points from sorted value array ───────────
function toCCDF(values: number[]): Array<{ x: number; y: number }> {
  const n = values.length
  if (n === 0) return []
  // Sample at most 300 points to keep chart fast
  const step   = Math.max(1, Math.floor(n / 300))
  const result = []
  for (let i = 0; i < n; i += step) {
    result.push({ x: values[i], y: (n - i) / n })
  }
  // Always include the last point
  if (result[result.length - 1]?.x !== values[n - 1]) {
    result.push({ x: values[n - 1], y: 1 / n })
  }
  return result
}



// ── Distribution Panel ─────────────────────────────────────────────
function DistributionPanel({
  distData,
  methods,
  sessionId,
}: {
  distData: DistributionReport
  methods: string[]
  sessionId: string
}) {
  const METHOD_COLORS: Record<string, string> = {
    hss: '#0F6E56',
    df:  '#BA7517',
    pa:  '#3C3489',
    lp:  '#993C1D',
    pa_lp: '#0F766E',
    high_pa: '#4F46E5',
    low_pa: '#7C3AED',
    high_lp: '#DC2626',
    low_lp: '#EA580C',
  }

  // Build degree CCDF series
  // We need the original from any method (they're all the same original)
  const firstMethod = methods[0]
  const origDegrees = distData[firstMethod]?.degree?.original ?? []
  const origWeights = distData[firstMethod]?.weight?.original ?? []

  function buildDegreeLines() {
    const lines: Array<{ id: string; color: string; points: Array<{ x: number; y: number }> }> = [
      { id: 'original', color: '#111827', points: toCCDF(origDegrees) },
    ]
    methods.forEach((mid) => {
      const d = distData[mid]?.degree?.backbone
      if (d) {
        lines.push({
          id:     mid.toUpperCase(),
          color:  METHOD_COLORS[mid] ?? '#888',
          points: toCCDF(d),
        })
      }
    })
    return lines
  }

  function buildWeightLines() {
    const lines: Array<{ id: string; color: string; points: Array<{ x: number; y: number }> }> = [
      { id: 'original', color: '#111827', points: toCCDF(origWeights) },
    ]
    methods.forEach((mid) => {
      const w = distData[mid]?.weight?.backbone
      if (w) {
        lines.push({
          id:     mid.toUpperCase(),
          color:  METHOD_COLORS[mid] ?? '#888',
          points: toCCDF(w),
        })
      }
    })
    return lines
  }

  // Merge all series into a unified x-domain for recharts
  function mergeForRecharts(
  lines: Array<{ id: string; points: Array<{ x: number; y: number }> }>
) {
  // Collect all unique x values from all series, filter out x=0 (invalid on log scale)
  const xSet = new Set<number>()
  lines.forEach((l) => l.points.forEach((p) => { if (p.x > 0) xSet.add(p.x) }))
  const xs = Array.from(xSet).sort((a, b) => a - b)

  return xs.map((x) => {
    const row: Record<string, number | null> = { x }
    lines.forEach(({ id, points }) => {
      if (points.length === 0) { row[id] = null; return }

      // Find last point with point.x <= x (step-function lookup)
      let y: number | null = null
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].x <= x) { y = points[i].y; break }
      }

      // If y is still null, x is below the minimum of this series.
      // For CCDF, P(X ≥ x) = 1 when x < min(series).
      if (y === null) y = 1.0

      // Guard against 0 on log scale (should not happen from toCCDF, but safety)
      row[id] = y > 0 ? y : null
    })
    return row
  })
}

  const degreeLines = buildDegreeLines()
  const weightLines = buildWeightLines()
  const degreeData  = mergeForRecharts(degreeLines)
  const weightData  = mergeForRecharts(weightLines)

  // KS summary table
  const ksDegree = methods.map((mid) => ({
    method: mid.toUpperCase(),
    ks:     distData[mid]?.degree?.ks ?? '—',
    color:  METHOD_COLORS[mid] ?? '#888',
  }))
  const ksWeight = methods.map((mid) => ({
    method: mid.toUpperCase(),
    ks:     distData[mid]?.weight?.ks ?? '—',
    color:  METHOD_COLORS[mid] ?? '#888',
  }))

  return (
    <div className="space-y-8">

      {/* Degree distribution */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-navy">
            Node Degree Distribution (CCDF)
          </h3>
          <PaperExportButton
            config={{
              figureType: 'ccdf',
              title: 'Node degree distribution (CCDF)',
              filename: `degree-distribution-${sessionId}`,
              payload: {
                title: 'Node degree distribution (CCDF)',
                subtitle: 'Lower KS means the backbone degree distribution is closer to the original.',
                series: degreeLines.map((l) => ({ id: l.id, label: l.id === 'original' ? 'Original' : l.id, color: l.color, points: l.points, emphasis: l.id === 'original', linestyle: l.id === 'original' ? '-' : '--' })),
                x_label: 'Degree',
                y_label: 'P(D ≥ d)',
                log_x: true,
                log_y: true,
              },
            }}
          />
        </div>
        <div id="chart-degree">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={degreeData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis
                dataKey="x"
                type="number"
                scale="log"
                domain={['auto', 'auto']}
                label={{ value: 'Degree', position: 'insideBottom', offset: -10, fontSize: 11 }}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.toFixed(0)}
              />
              <YAxis
                scale="log"
                domain={[0.0001, 1]}
                label={{ value: 'P(D ≥ d)', angle: -90, position: 'insideLeft', offset: 15, fontSize: 11 }}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.toExponential(0)}
              />
              <Tooltip
                formatter={(val: number, name: string) => [val.toExponential(3), name]}
                labelFormatter={(v) => `Degree: ${v}`}
              />
              <Legend verticalAlign="top" height={28} iconSize={10}
                formatter={(value) => {
                  if (value === 'original') return 'Original'
                  const mid = value.toLowerCase()
                  const ks  = distData[mid]?.degree?.ks
                  return `${value}  KS=${ks ?? '?'}`
                }}
              />
              {degreeLines.map((l) => (
                <Line
                  key={l.id}
                  type="stepAfter"
                  dataKey={l.id}
                  stroke={l.color}
                  strokeWidth={l.id === 'original' ? 2.5 : 1.5}
                  dot={false}
                  connectNulls={false}
                  strokeDasharray={l.id === 'original' ? undefined : '4 2'}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* KS table */}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {ksDegree.map((r) => (
            <span key={r.method}
              className="px-2 py-0.5 rounded font-mono"
              style={{ backgroundColor: r.color + '1A', color: r.color, border: `1px solid ${r.color}40` }}>
              {r.method} KS = {r.ks}
            </span>
          ))}
        </div>
      </div>

      {/* Weight distribution */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-navy">
            Edge Weight Distribution (CCDF)
          </h3>
          <PaperExportButton
            config={{
              figureType: 'ccdf',
              title: 'Edge weight distribution (CCDF)',
              filename: `weight-distribution-${sessionId}`,
              payload: {
                title: 'Edge weight distribution (CCDF)',
                subtitle: 'Lower KS means the backbone weight distribution is closer to the original.',
                series: weightLines.map((l) => ({ id: l.id, label: l.id === 'original' ? 'Original' : l.id, color: l.color, points: l.points, emphasis: l.id === 'original', linestyle: l.id === 'original' ? '-' : '--' })),
                x_label: 'Weight',
                y_label: 'P(W ≥ w)',
                log_x: true,
                log_y: true,
              },
            }}
          />
        </div>
        <div id="chart-weight">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={weightData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis
                dataKey="x"
                type="number"
                scale="log"
                domain={['auto', 'auto']}
                label={{ value: 'Weight', position: 'insideBottom', offset: -10, fontSize: 11 }}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.toFixed(0)}
              />
              <YAxis
                scale="log"
                domain={[0.0001, 1]}
                label={{ value: 'P(W ≥ w)', angle: -90, position: 'insideLeft', offset: 15, fontSize: 11 }}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => v.toExponential(0)}
              />
              <Tooltip
                formatter={(val: number, name: string) => [val.toExponential(3), name]}
                labelFormatter={(v) => `Weight: ${v}`}
              />
              <Legend verticalAlign="top" height={28} iconSize={10}
                formatter={(value) => {
                  if (value === 'original') return 'Original'
                  const mid = value.toLowerCase()
                  const ks  = distData[mid]?.weight?.ks
                  return `${value}  KS=${ks ?? '?'}`
                }}
              />
              {weightLines.map((l) => (
                <Line
                  key={l.id}
                  type="stepAfter"
                  dataKey={l.id}
                  stroke={l.color}
                  strokeWidth={l.id === 'original' ? 2.5 : 1.5}
                  dot={false}
                  connectNulls={false}
                  strokeDasharray={l.id === 'original' ? undefined : '4 2'}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* KS table */}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {ksWeight.map((r) => (
            <span key={r.method}
              className="px-2 py-0.5 rounded font-mono"
              style={{ backgroundColor: r.color + '1A', color: r.color, border: `1px solid ${r.color}40` }}>
              {r.method} KS = {r.ks}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        CCDF = Complementary Cumulative Distribution Function — P(X ≥ x).
        Lower KS statistic means the backbone distribution is closer to the original.
        Matches Figures 4 &amp; 5 in the WAW2025 paper.
      </p>
    </div>
  )
}

export default function Step7() {
  const {
    sessionId, datasetId, isCustomDataset,
    selectedMethods, setEvaluationReady, goToStep
  } = useWorkflowStore()

  const { data: metricsList = [] } = useMetricsList()

  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(
    new Set(metricsList.map(m => m.id))
  )
  const [viewMode,  setViewMode]  = useState<'table' | 'radar' | 'distributions'>('table')
  const [report,    setReport]    = useState<EvaluationReport | null>(null)
const [distData,  setDistData]  = useState<DistributionReport | null>(null)
const [loading,   setLoading]   = useState(false)
const [error,     setError]     = useState<string | null>(null)

  // Sync selectedMetrics when metricsList loads
  useEffect(() => {
    if (metricsList.length > 0 && selectedMetrics.size === 0) {
      setSelectedMetrics(new Set(metricsList.map(m => m.id)))
    }
  }, [metricsList])

  function toggleMetric(id: string) {
    setSelectedMetrics(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleRun() {
    if (!sessionId || !datasetId) return
    setLoading(true)
    setError(null)
    try {
      const [result, dists] = await Promise.all([
        runEvaluation(
          sessionId, datasetId, selectedMethods,
          [...selectedMetrics], isCustomDataset
        ),
        fetchDistributions(sessionId, datasetId, selectedMethods, isCustomDataset),
      ])
      setReport(result)
      setDistData(dists)
      setEvaluationReady(true)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Evaluation failed.')
    }
    setLoading(false)
  }

  // Build radar data: one entry per metric
  const radarData = useMemo(() => {
    if (!report) return []
    const metricIds = metricsList.filter(m => selectedMetrics.has(m.id)).map(m => m.id)
    return metricIds.map(mid => {
      const entry: Record<string, number | string> = {
        metric: metricsList.find(m => m.id === mid)?.label ?? mid
      }
      selectedMethods.forEach(sid => {
        const val = report[sid]?.[mid]?.value ?? 0
        entry[sid] = Math.min(Math.abs(val), 1)  // normalise to [0,1] for display
      })
      return entry
    })
  }, [report, metricsList, selectedMethods, selectedMetrics])

  const RADAR_COLORS = ['#0F6E56', '#BA7517', '#3C3489', '#993C1D', '#0F766E', '#4F46E5', '#7C3AED', '#DC2626', '#EA580C']

  return (
    <StepCard stepNumber={7} title="Evaluation"
      subtitle="Compare each backbone to the original graph on structural properties.">

      {/* Metric selector */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Select Metrics
          </span>
          <button
            onClick={() => setSelectedMetrics(
              selectedMetrics.size === metricsList.length
                ? new Set()
                : new Set(metricsList.map(m => m.id))
            )}
            className="text-xs text-teal hover:underline">
            {selectedMetrics.size === metricsList.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {metricsList.map(m => (
            <button key={m.id} onClick={() => toggleMetric(m.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                selectedMetrics.has(m.id)
                  ? 'bg-navy text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Run button */}
      {!report && (
        <div className="text-center py-6">
          <Button onClick={handleRun} loading={loading}
            disabled={selectedMetrics.size === 0}>
            ▶ Run Evaluation
          </Button>
        </div>
      )}

      {error && (
        <div className="bg-coral-bg border border-coral/30 rounded-lg px-4 py-3 text-sm text-coral mb-4">
          ❌ {error}
        </div>
      )}

      {/* Results */}
      {report && (
        <>
          {/* View toggle + export */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
              {(['table', 'radar' ,'distributions'] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    viewMode === mode ? 'bg-white shadow text-navy' : 'text-gray-500'
                  }`}>
                  {mode === 'table' ? '📋 Table' : mode === 'radar' ? '🕸 Radar' : '📊 Distributions'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary"
                onClick={() => { setReport(null); setLoading(false) }}>
                ↺ Rerun
              </Button>
              <Button onClick={() => downloadEvaluationCsv(sessionId)}>
                ⬇ Export CSV
              </Button>
            </div>
          </div>

          {/* TABLE VIEW — matches paper Table 2 format */}
{viewMode === 'table' && (
  <div className="overflow-x-auto">
   <div className="flex items-center justify-between mb-3 gap-3">
  <span className="text-xs text-gray-400">
    Topological properties of extracted backbones 
  </span>
  <PaperExportButton
    config={{
      figureType: 'table',
      title: 'Evaluation table',
      filename: `evaluation-table-${sessionId}`,
      payload: {
        title: 'Topological properties of extracted backbones',
        subtitle: 'Value metrics are shown directly. Deviation metrics are relative to the original graph.',
        columns: [
          { key: 'property', label: 'Property' },
          ...selectedMethods.map((id) => ({ key: id, label: METHODS.find((x) => x.id === id)?.short ?? id.toUpperCase() })),
        ],
        rows: metricsList.filter((m) => selectedMetrics.has(m.id)).map((metric) => {
          const displayType = METRIC_DISPLAY_TYPE[metric.id] ?? 'value'
          const row: Record<string, string> = { property: metric.label }
          selectedMethods.forEach((sid) => {
            const r = report[sid]?.[metric.id]
            if (!r) { row[sid] = '—'; return }
            const displayNum = displayType === 'deviation' ? r.deviation : r.value
            row[sid] = metric.id === 'num_components' ? `${Math.round(displayNum)}` : displayNum.toFixed(2)
          })
          return row
        }),
      },
    }}
  />
</div>
    <div id="eval-table">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left pb-3 text-gray-500 font-semibold pr-6 text-xs uppercase tracking-wide">
              Property
            </th>
            {selectedMethods.map(id => {
              const m = METHODS.find(x => x.id === id)
              return (
                <th key={id} className="pb-3 text-center font-bold px-6 text-sm"
                  style={{ color: m?.color }}>
                  {m?.short}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {metricsList.filter(m => selectedMetrics.has(m.id)).map((metric, i) => {
            const displayType = METRIC_DISPLAY_TYPE[metric.id] ?? 'value'
            const isDeviation = displayType === 'deviation'
            return (
              <tr key={metric.id}
                className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="py-3 pr-6 font-medium text-navy text-sm">
                  {metric.label}
                </td>
                {selectedMethods.map(sid => {
                  const r = report[sid]?.[metric.id]
                  if (!r) return <td key={sid} className="py-3 px-6 text-center text-gray-300">—</td>

                  // Choose what number to display
                  const displayNum = isDeviation ? r.deviation : r.value
                  const formattedNum = metric.id === 'num_components'
                    ? Math.round(displayNum).toString()
                    : displayNum.toFixed(2)

                  // Colour: for deviation metrics use magnitude, for value metrics neutral
                  const { bg, text } = isDeviation
                    ? deviationColour(r.deviation)
                    : { bg: 'transparent', text: '#374151' }

                  const sign = isDeviation && displayNum > 0 ? '+' : ''

                  return (
                    <td key={sid} className="py-3 px-6 text-center">
                      <span
                        className={`font-mono text-sm font-semibold px-2 py-0.5 rounded ${isDeviation ? '' : ''}`}
                        style={{ backgroundColor: isDeviation ? bg : 'transparent', color: isDeviation ? text : '#1f2937' }}>
                        {sign}{formattedNum}
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    {/* Legend */}
    <div className="mt-4 flex gap-4 text-xs text-gray-400 flex-wrap items-center">
      <span>Deviation metrics (coloured): signed relative deviation from original.</span>
      <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#E1F5EE', color: '#0F6E56' }}>Green |Δ| ≤ 10%</span>
      <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FAEEDA', color: '#BA7517' }}>Amber |Δ| ≤ 25%</span>
      <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FAECE7', color: '#993C1D' }}>Coral |Δ| &gt; 25%</span>
    </div>
  </div>
)}

          {/* RADAR VIEW */}
            {viewMode === 'radar' && radarData.length > 0 && (
              <div>
                <div className="flex justify-end mb-2">
                  <PaperExportButton
                    config={{
                      figureType: 'radar',
                      title: 'Evaluation radar chart',
                      filename: `radar-chart-${sessionId}`,
                      payload: {
                        title: 'Evaluation radar chart',
                        subtitle: 'Metrics normalised to [0,1] for visual comparison only.',
                        categories: radarData.map((d) => String(d.metric)),
                        series: selectedMethods.map((sid, i) => ({
                          label: METHODS.find((x) => x.id === sid)?.short ?? sid,
                          color: RADAR_COLORS[i] ?? '#999999',
                          values: radarData.map((d) => Number(d[sid] ?? 0)),
                        })),
                      },
                    }}
                  />
                </div>
                <div id="chart-radar">
                <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 1]} tick={false} />
                  {selectedMethods.map((sid, i) => {
                    const m = METHODS.find(x => x.id === sid)
                    return (
                      <Radar key={sid} name={m?.short ?? sid} dataKey={sid}
                        stroke={RADAR_COLORS[i] ?? '#999'}
                        fill={RADAR_COLORS[i] ?? '#999'}
                        fillOpacity={0.15} />
                    )
                  })}
                  <Legend />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
              </div>
            <p className="text-xs text-gray-400 text-center mt-2">
              Values normalised to [0,1]. A polygon closer to the outer edge means higher absolute metric value.
            </p>
          </div>
          )}
        </>
        
      )}
      {/* DISTRIBUTIONS VIEW */}
          {viewMode === 'distributions' && distData && (
            <DistributionPanel
              distData={distData}
              methods={selectedMethods}
              sessionId={sessionId}
            />
          )}
      

      <div className="flex justify-between pt-6">
        <Button variant="secondary" onClick={() => goToStep(6)}>← Back</Button>
        <span className="text-xs text-gray-400 self-center">
          🎉 Analysis complete!
        </span>
      </div>
    </StepCard>
  )
}
