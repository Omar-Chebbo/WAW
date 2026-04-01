import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useWorkflowStore } from '../../store/workflowStore'
import {
  runAnomalyLabeling,
  runManualLabeling,
  fetchDistribution,
} from '../../api/client'
import { METHODS } from '../../constants/methods'
import { Button } from '../ui'
import type { AnomalySummary, DistributionBin } from '../../types'
import { downloadPngByContainerId, downloadSvgByContainerId } from '../../utils/svgExport'

type WorkspaceMode = 'wizard' | 'lab'

interface Props {
  mode?: WorkspaceMode
}

function formatTransformName(id?: string | null) {
  if (!id) return 'Auto'
  if (id === 'raw') return 'None'

  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function AnomalyLabelingWorkspace({
  mode = 'wizard',
}: Props) {
  const {
    sessionId,
    selectedMethods,
    scoresReady,
    anomaliesReady,
    preprocessingByMethod,
    setAnomalyReady,
    goToStep,
    setLabTab,
  } = useWorkflowStore()

  const relevantMethods = METHODS.filter(
    (m) => selectedMethods.includes(m.id) && m.requires_anomaly
  )

  useEffect(() => {
    if (mode === 'wizard' && scoresReady && relevantMethods.length === 0) {
      goToStep(5)
    }
  }, [mode, scoresReady, relevantMethods.length, goToStep])

  const [activeTab, setActiveTab] = useState(relevantMethods[0]?.id ?? '')
  const [summaries, setSummaries] = useState<Record<string, AnomalySummary>>({})
  const [dists, setDists] = useState<Record<string, DistributionBin[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [percentiles, setPercentiles] = useState<Record<string, number>>({})
  const [debounce, setDebounce] = useState<Record<string, number>>({})

  useEffect(() => {
    if (relevantMethods.length === 0) {
      setActiveTab('')
      return
    }

    const stillExists = relevantMethods.some((m) => m.id === activeTab)
    if (!stillExists) {
      setActiveTab(relevantMethods[0].id)
    }
  }, [relevantMethods, activeTab])

  async function autoLabel(methodId: string) {
    setLoading((l) => ({ ...l, [methodId]: true }))

    try {
      const selectedMode = preprocessingByMethod[methodId]
      if (!selectedMode) return

      const res = await runAnomalyLabeling(
        sessionId,
        methodId,
        selectedMode
      )

      setSummaries((s) => ({ ...s, [methodId]: res.summary }))
      setAnomalyReady(methodId, true)

      const dist = await fetchDistribution(sessionId, methodId)
      setDists((d) => ({ ...d, [methodId]: dist }))
    } catch (e) {
      console.error(e)
    }

    setLoading((l) => ({ ...l, [methodId]: false }))
  }

  useEffect(() => {
  relevantMethods.forEach((m) => {
    if (preprocessingByMethod[m.id]) {
      autoLabel(m.id)
    }
  })
}, [sessionId, selectedMethods, preprocessingByMethod]) // eslint-disable-line

  const handleSliderChange = useCallback(
    (methodId: string, value: number) => {
      setPercentiles((p) => ({ ...p, [methodId]: value }))

      if (debounce[methodId]) clearTimeout(debounce[methodId])

      const t = window.setTimeout(async () => {
        setLoading((l) => ({ ...l, [methodId]: true }))

        try {
          const res = await runManualLabeling(sessionId, methodId, value)
          setSummaries((s) => ({ ...s, [methodId]: res.summary }))

          const dist = await fetchDistribution(sessionId, methodId)
          setDists((d) => ({ ...d, [methodId]: dist }))
        } catch (e) {
          console.error(e)
        }

        setLoading((l) => ({ ...l, [methodId]: false }))
      }, 350)

      setDebounce((d) => ({ ...d, [methodId]: t }))
    },
    [sessionId, debounce]
  )

  async function resetToAuto(methodId: string) {
    setPercentiles((p) => {
      const next = { ...p }
      delete next[methodId]
      return next
    })
    await autoLabel(methodId)
  }

  const allDone = relevantMethods.every((m) => anomaliesReady[m.id])

  const handleBack = () => {
    if (mode === 'lab') {
      setLabTab('preprocessing')
      return
    }
    goToStep(3)
  }

  const handleNext = () => {
    if (mode === 'lab') {
      setLabTab('backbone')
      return
    }
    goToStep(5)
  }

  if (relevantMethods.length === 0) {
    return (
      <div>
        <div className="text-center py-8 text-gray-400">
          None of your selected methods require anomaly labeling.
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={handleBack}>
            {mode === 'lab' ? '← Back to Preprocessing' : '← Back'}
          </Button>

          <Button onClick={handleNext}>
            {mode === 'lab' ? 'Continue to Backbone →' : 'Next →'}
          </Button>
        </div>
      </div>
    )
  }

  const visibleMethods =
    relevantMethods.length === 1
      ? relevantMethods
      : relevantMethods.filter((m) => m.id === activeTab)

  return (
    <div>
      {relevantMethods.length > 1 && (
        <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
          {relevantMethods.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveTab(m.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === m.id
                  ? 'text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
              style={activeTab === m.id ? { backgroundColor: m.color } : {}}
            >
              {m.short}
            </button>
          ))}
        </div>
      )}

      {visibleMethods.map((m) => {
        const summary = summaries[m.id]
        const dist = dists[m.id] ?? []
        const isLoading = loading[m.id]
        const pct = percentiles[m.id]
        const isManual = pct !== undefined
        const selectedMode = preprocessingByMethod[m.id]

        return (
          <div key={m.id}>
            {isLoading && (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <svg
                  className="animate-spin w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8z"
                  />
                </svg>
                <span>Running Isolation Forest…</span>
              </div>
            )}
            {!selectedMode && !isLoading && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-4">
              <div className="text-sm font-semibold text-amber-800 mb-1">
                Preprocessing not selected yet
              </div>
              <p className="text-sm text-amber-700">
                Choose a preprocessing mode first before anomaly labeling can run for {m.short}.
              </p>
            </div>
          )}

            {summary && !isLoading && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div
                    className="text-2xl font-bold"
                    style={{ color: m.color }}
                  >
                    {summary.flagged.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Backbone edges
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">
                    {summary.pct}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    of total edges
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">
                    {summary.total.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Total edges
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-lg font-bold text-gray-700">
                    {formatTransformName(summary.selected_transform)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Applied preprocessing
                  </div>
                </div>
              </div>
            )}

            {dist.length > 0 && !isLoading && (
  <div className="mb-6">
    <div className="flex items-center justify-between mb-3">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Score Distribution
      </div>

      <div className="flex gap-2">
        <button
          onClick={() =>
            downloadSvgByContainerId(
              `anomaly-chart-${mode}-${m.id}`,
              `score-distribution-${m.id}.svg`
            )
          }
          className="px-2 py-1 text-xs bg-white border border-gray-200 rounded shadow-sm
                     hover:bg-gray-50 text-gray-600 font-medium"
        >
          ⬇ SVG
        </button>

        <button
          onClick={() =>
            void downloadPngByContainerId(
              `anomaly-chart-${mode}-${m.id}`,
              `score-distribution-${m.id}.png`,
              4
            )
          }
          className="px-2 py-1 text-xs bg-white border border-gray-200 rounded shadow-sm
                     hover:bg-gray-50 text-gray-600 font-medium"
        >
          ⬇ PNG 4x
        </button>
      </div>
    </div>

    <div id={`anomaly-chart-${mode}-${m.id}`}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={dist} margin={{ left: -20, right: 10, top: 10, bottom: 10 }}>
          <XAxis
            dataKey="bin"
            tickFormatter={(v) => Number(v).toFixed(1)}
            tick={{ fontSize: 11 }}
            label={{ value: 'Normalized score', position: 'insideBottom', offset: -6, fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            label={{ value: 'Edge count', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }}
          />
          <Tooltip
            formatter={(val, name) => [
              val,
              name === 'backbone' ? 'Backbone edges' : 'Normal edges',
            ]}
            labelFormatter={(l) => `Score ≈ ${Number(l).toFixed(2)}`}
          />
          <Legend
            verticalAlign="top"
            height={28}
            formatter={(v) =>
              v === 'backbone' ? 'Backbone (flagged)' : 'Normal'
            }
          />
          <Bar dataKey="normal" fill="#d1d5db" stackId="a" />
          <Bar dataKey="backbone" fill={m.color} stackId="a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
)}

            {summary && !isLoading && (
              <div className="bg-gray-50 rounded-xl p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-navy">
                    Manual Threshold
                  </div>

                  {isManual && (
                    <button
                      onClick={() => resetToAuto(m.id)}
                      className="text-xs text-teal hover:underline"
                    >
                      ↺ Reset manual threshold
                    </button>
                  )}
                </div>

                <div className="text-xs text-gray-500 mb-4">
                  Edges in the top <strong>{100 - (pct ?? 80)}%</strong> of
                  scores are flagged as backbone.
                  {!isManual && (
                    <span className="text-teal ml-2">
                      (currently using Isolation Forest with the selected preprocessing mode)
                    </span>
                  )}
                </div>

                <input
                  type="range"
                  min={0}
                  max={99}
                  step={1}
                  value={pct ?? 80}
                  onChange={(e) =>
                    handleSliderChange(m.id, Number(e.target.value))
                  }
                  className="w-full accent-teal"
                />

                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>More edges</span>
                  <span>Fewer edges</span>
                </div>
              </div>
            )}

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
        <Button variant="secondary" onClick={handleBack}>
          {mode === 'lab' ? '← Back to Preprocessing' : '← Back'}
        </Button>

        <Button onClick={handleNext} disabled={!allDone}>
          {mode === 'lab'
            ? 'Continue to Backbone →'
            : 'Next: Extract Backbone →'}
        </Button>
      </div>
    </div>
  )
}