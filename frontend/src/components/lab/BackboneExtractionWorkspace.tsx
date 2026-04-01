import React, { useMemo, useState } from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import { extractBackbones } from '../../api/client'
import { METHODS } from '../../constants/methods'
import { Button } from '../ui'
import type { BackboneSummary } from '../../types'

type WorkspaceMode = 'wizard' | 'lab'

interface Props {
  mode?: WorkspaceMode
}

export default function BackboneExtractionWorkspace({
  mode = 'wizard',
}: Props) {
  const {
    sessionId,
    selectedMethods,
    anomaliesReady,
    backbonesReady,
    setBackboneReady,
    goToStep,
    setLabTab,
  } = useWorkflowStore()

  const selectedMethodDefs = METHODS.filter((m) => selectedMethods.includes(m.id))

  const readyMethods = useMemo(
    () =>
      selectedMethodDefs.filter(
        (m) => !m.requires_anomaly || anomaliesReady[m.id]
      ),
    [selectedMethodDefs, anomaliesReady]
  )

  const blockedMethods = useMemo(
    () =>
      selectedMethodDefs.filter(
        (m) => m.requires_anomaly && !anomaliesReady[m.id]
      ),
    [selectedMethodDefs, anomaliesReady]
  )

  const [loading, setLoading] = useState(false)
  const [summaries, setSummaries] = useState<Record<string, BackboneSummary>>({})
  const [error, setError] = useState<string | null>(null)

  const allDone =
    selectedMethodDefs.length > 0 &&
    selectedMethodDefs.every((m) => backbonesReady[m.id])

  async function handleExtractReadyMethods() {
    if (readyMethods.length === 0) return

    setLoading(true)
    setError(null)

    try {
      const result = await extractBackbones(
        sessionId,
        readyMethods.map((m) => m.id)
      )

      setSummaries(result)

      Object.keys(result).forEach((methodId) => {
        setBackboneReady(methodId, true)
      })
    } catch (e) {
      console.error(e)
      setError('Failed to extract backbone results.')
    }

    setLoading(false)
  }

  const handleBack = () => {
    if (mode === 'lab') {
      setLabTab('labeling')
      return
    }
    goToStep(4)
  }

  const handleNext = () => {
    if (mode === 'lab') {
      setLabTab('visualization')
      return
    }
    goToStep(6)
  }

  if (selectedMethodDefs.length === 0) {
    return (
      <div>
        <div className="text-center py-8 text-gray-400">
          No methods selected yet.
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={handleBack}>
            {mode === 'lab' ? '← Back to Labeling' : '← Back'}
          </Button>

          <Button onClick={handleNext} disabled>
            {mode === 'lab' ? 'Continue to Visualization →' : 'Next →'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {blockedMethods.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="text-sm font-semibold text-amber-800 mb-1">
            Some methods are not ready yet
          </div>
          <p className="text-sm text-amber-700">
            Methods that depend on anomaly labeling must finish labeling before
            backbone extraction.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {blockedMethods.map((m) => (
              <span
                key={m.id}
                className="px-3 py-1 rounded-full text-xs font-semibold text-amber-800 bg-amber-100"
              >
                {m.short} waiting for labeling
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-base font-bold text-navy">
              Extract backbone results
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Ready methods can now produce backbone graphs and summary metrics.
            </p>
          </div>

          <Button
            onClick={handleExtractReadyMethods}
            disabled={loading || readyMethods.length === 0}
          >
            {loading ? 'Extracting…' : 'Extract Ready Methods'}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {readyMethods.map((m) => (
            <span
              key={m.id}
              className="px-3 py-1 rounded-full text-white text-sm font-semibold"
              style={{ backgroundColor: m.color }}
            >
              {m.short} ready
            </span>
          ))}
        </div>

        {error && (
          <div className="mt-4 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {selectedMethodDefs.map((m) => {
          const summary = summaries[m.id]
          const isBlocked = m.requires_anomaly && !anomaliesReady[m.id]
          const isReady = backbonesReady[m.id]

          return (
            <div
              key={m.id}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-base font-bold text-navy">
                    {m.short} — {m.label}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {m.description}
                  </p>
                </div>

                <span
                  className="px-3 py-1 rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: m.color }}
                >
                  {isBlocked ? 'Blocked' : isReady ? 'Extracted' : 'Pending'}
                </span>
              </div>

              {summary ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-800">
                      {summary.edges}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Backbone edges
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-800">
                      {summary.nodes}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Backbone nodes
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-800">
                      {summary.edge_retention}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Edge retention
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-800">
                      {summary.node_retention}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Node retention
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                  {isBlocked
                    ? 'Finish anomaly labeling first for this method.'
                    : 'No backbone extracted yet for this method in the current lab view.'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={handleBack}>
          {mode === 'lab' ? '← Back to Labeling' : '← Back'}
        </Button>

        <Button onClick={handleNext} disabled={!allDone}>
          {mode === 'lab'
            ? 'Continue to Visualization →'
            : 'Next: Visual Comparison →'}
        </Button>
      </div>
    </div>
  )
}