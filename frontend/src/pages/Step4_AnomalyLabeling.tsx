/**
 * pages/Step4_AnomalyLabeling.tsx
 * Runs Isolation Forest anomaly labeling for methods that need it.
 * Shows a score distribution histogram + a manual threshold slider.
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { useWorkflowStore } from '../store/workflowStore'
import {
  runAnomalyLabeling, runManualLabeling, fetchDistribution
} from '../api/client'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'
import type { AnomalySummary, DistributionBin } from '../types'

function formatTransformName(id?: string | null) {
  if (!id) return 'Auto'
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export default function Step4() {
  const {
    sessionId, selectedMethods, scoresReady,
    anomaliesReady, setAnomalyReady, goToStep
  } = useWorkflowStore()

  // Only methods that require anomaly labeling appear on this page
  const relevantMethods = METHODS.filter(
    m => selectedMethods.includes(m.id) && m.requires_anomaly
  )

  // If no method needs anomaly labeling, skip this step automatically
  useEffect(() => {
    if (scoresReady && relevantMethods.length === 0) {
      goToStep(5)
    }
  }, [scoresReady, relevantMethods.length, goToStep])

  const [activeTab,   setActiveTab]   = useState(relevantMethods[0]?.id ?? '')
  const [summaries,   setSummaries]   = useState<Record<string, AnomalySummary>>({})
  const [dists,       setDists]       = useState<Record<string, DistributionBin[]>>({})
  const [loading,     setLoading]     = useState<Record<string, boolean>>({})
  const [percentiles, setPercentiles] = useState<Record<string, number>>({})
  const [debounce,    setDebounce]    = useState<Record<string, number>>({})

  // Auto-run labeling for each required method when we land on this step
  useEffect(() => {
    relevantMethods.forEach(m => {
      if (!anomaliesReady[m.id]) autoLabel(m.id)
    })
  }, [])   // eslint-disable-line

  async function autoLabel(methodId: string) {
    setLoading(l => ({ ...l, [methodId]: true }))
    try {
      const res = await runAnomalyLabeling(sessionId, methodId)
      setSummaries(s => ({ ...s, [methodId]: res.summary }))
      setAnomalyReady(methodId, true)
      const dist = await fetchDistribution(sessionId, methodId)
      setDists(d => ({ ...d, [methodId]: dist }))
    } catch (e) {
      console.error(e)
    }
    setLoading(l => ({ ...l, [methodId]: false }))
  }

  // Debounced re-label when slider changes
  const handleSliderChange = useCallback((methodId: string, value: number) => {
    setPercentiles(p => ({ ...p, [methodId]: value }))
    if (debounce[methodId]) clearTimeout(debounce[methodId])
    const t = setTimeout(async () => {
      setLoading(l => ({ ...l, [methodId]: true }))
      try {
        const res = await runManualLabeling(sessionId, methodId, value)
        setSummaries(s => ({ ...s, [methodId]: res.summary }))
        const dist = await fetchDistribution(sessionId, methodId)
        setDists(d => ({ ...d, [methodId]: dist }))
      } catch {}
      setLoading(l => ({ ...l, [methodId]: false }))
    }, 350)
    setDebounce(d => ({ ...d, [methodId]: t }))
  }, [sessionId, debounce])

  async function resetToAuto(methodId: string) {
    setPercentiles(p => { const n={...p}; delete n[methodId]; return n })
    await autoLabel(methodId)
  }

  const allDone = relevantMethods.every(m => anomaliesReady[m.id])

  if (relevantMethods.length === 0) {
    return (
      <StepCard stepNumber={4} title="Anomaly Labeling" subtitle="Skipping — not needed for your selected methods.">
        <div className="text-center py-8 text-gray-400">
          None of your selected methods require anomaly labeling. Proceeding…
        </div>
        <div className="flex justify-between">
          <Button variant="secondary" onClick={() => goToStep(3)}>← Back</Button>
          <Button onClick={() => goToStep(5)}>Next →</Button>
        </div>
      </StepCard>
    )
  }

  return (
    <StepCard stepNumber={4} title="Anomaly Labeling"
      subtitle="Identify backbone edges using Isolation Forest. Adjust the threshold slider to fine-tune which edges are flagged.">

      {/* Method tabs */}
      {relevantMethods.length > 1 && (
        <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
          {relevantMethods.map(m => (
            <button key={m.id} onClick={() => setActiveTab(m.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === m.id ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
              style={activeTab === m.id ? { backgroundColor: m.color } : {}}>
              {m.short}
            </button>
          ))}
        </div>
      )}

      {relevantMethods.filter(m => m.id === (relevantMethods.length === 1 ? m.id : activeTab)).map(m => {
        const summary = summaries[m.id]
        const dist    = dists[m.id] ?? []
        const isLoading = loading[m.id]
        const pct   = percentiles[m.id]
        const isManual = pct !== undefined

        return (
          <div key={m.id}>
            {/* Loading state */}
            {isLoading && (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                <span>Running Isolation Forest…</span>
              </div>
            )}

            {/* Stats row */}
            {summary && !isLoading && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold" style={{ color: m.color }}>
                    {summary.flagged.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Backbone edges</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">{summary.pct}%</div>
                  <div className="text-xs text-gray-500 mt-1">of total edges</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">{summary.total.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-1">Total edges</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-lg font-bold text-gray-700">
                    {formatTransformName(summary.selected_transform)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Auto preprocessing</div>
                </div>
              </div>
            )}

            {/* Distribution histogram */}
            {dist.length > 0 && !isLoading && (
              <div className="mb-6">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Score Distribution
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dist} margin={{ left: -20 }}>
                    <XAxis dataKey="bin" tickFormatter={v => v.toFixed(1)} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(val, name) => [val, name === 'backbone' ? 'Backbone edges' : 'Normal edges']}
                      labelFormatter={l => `Score ≈ ${Number(l).toFixed(2)}`}
                    />
                    <Legend formatter={v => v === 'backbone' ? 'Backbone (flagged)' : 'Normal'} />
                    <Bar dataKey="normal"   fill="#d1d5db" stackId="a" />
                    <Bar dataKey="backbone" fill={m.color}   stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Threshold slider */}
            {summary && !isLoading && (
              <div className="bg-gray-50 rounded-xl p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-navy">Manual Threshold</div>
                  {isManual && (
                    <button onClick={() => resetToAuto(m.id)}
                      className="text-xs text-teal hover:underline">
                      ↺ Reset to auto (Isolation Forest)
                    </button>
                  )}
                </div>
                <div className="text-xs text-gray-500 mb-4">
                  Edges in the top <strong>{100 - (pct ?? 80)}%</strong> of scores are flagged as backbone.
                  {!isManual && <span className="text-teal ml-2">(currently using Isolation Forest auto-detection)</span>}
                </div>
                <input type="range" min={0} max={99} step={1}
                  value={pct ?? 80}
                  onChange={e => handleSliderChange(m.id, Number(e.target.value))}
                  className="w-full accent-teal"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>More edges</span>
                  <span>Fewer edges</span>
                </div>
              </div>
            )}

            {/* Done indicator */}
            {anomaliesReady[m.id] && !isLoading && (
              <div className="flex items-center gap-2 text-sm text-teal">
                <span>✅</span>
                <span>Labeling complete for {m.short}</span>
              </div>
            )}
          </div>
        )
      })}

      <div className="flex justify-between pt-6">
        <Button variant="secondary" onClick={() => goToStep(3)}>← Back</Button>
        <Button onClick={() => goToStep(5)} disabled={!allDone}>
          Next: Extract Backbone →
        </Button>
      </div>
    </StepCard>
  )
}
