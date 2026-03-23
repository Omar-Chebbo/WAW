/**
 * pages/Step5_BackboneExtraction.tsx
 * Extracts the backbone graph for every selected method and shows
 * a summary card per method (node/edge retention stats).
 */
import React, { useState } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { extractBackbones } from '../api/client'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'
import type { BackboneSummary } from '../types'

export default function Step5() {
  const {
    sessionId, selectedMethods,
    backbonesReady, setBackboneReady, goToStep
  } = useWorkflowStore()

  const [loading,   setLoading]   = useState(false)
  const [summaries, setSummaries] = useState<Record<string, BackboneSummary>>({})
  const [error,     setError]     = useState<string | null>(null)

  const allDone = selectedMethods.every(id => backbonesReady[id])

  async function handleExtract() {
    setLoading(true)
    setError(null)
    try {
      const results = await extractBackbones(sessionId, selectedMethods)
      setSummaries(results)
      Object.keys(results).forEach(id => setBackboneReady(id, true))
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Extraction failed. Check anomaly labeling was completed.')
    }
    setLoading(false)
  }

  // Retention percentage → colour
  function retentionColour(pct: number) {
    if (pct > 60) return '#BA7517'   // amber = kept a lot
    if (pct > 25) return '#0F6E56'   // teal  = good reduction
    return '#3C3489'                  // purple = heavy reduction
  }

  return (
    <StepCard stepNumber={5} title="Extract Backbone"
      subtitle="Apply each method's threshold to produce the final backbone subgraph.">

      {/* Pre-extraction summary table */}
      {!allDone && (
        <div className="mb-8">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-2 text-gray-400 font-medium">Method</th>
                <th className="pb-2 text-gray-400 font-medium">Extraction rule</th>
                <th className="pb-2 text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedMethods.map(id => {
                const m = METHODS.find(x => x.id === id)
                const rules: Record<string, string> = {
                  hss: 'hss_score ≥ 0.8',
                  df:  'p-value < 0.05',
                  pa:  'Anomaly score = −1 (Isolation Forest)',
                  lp:  'Anomaly score = −1 (Isolation Forest)',
                }
                return (
                  <tr key={id} className="border-b border-gray-50 py-2">
                    <td className="py-3">
                      <span className="font-bold mr-2" style={{ color: m?.color }}>{m?.short}</span>
                      <span className="text-gray-500 text-xs">{m?.label}</span>
                    </td>
                    <td className="py-3 font-mono text-xs text-gray-600">
                      {rules[id] ?? '—'}
                    </td>
                    <td className="py-3">
                      {backbonesReady[id]
                        ? <span className="text-teal text-xs">✓ Ready</span>
                        : <span className="text-gray-400 text-xs">Pending</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="mt-6 text-center">
            <Button onClick={handleExtract} loading={loading}>
              🔬 Extract Backbones
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-coral-bg border border-coral/30 rounded-lg px-4 py-3 text-sm text-coral mb-4">
          ❌ {error}
        </div>
      )}

      {/* Results cards */}
      {Object.keys(summaries).length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Extraction Results
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedMethods.map(id => {
              const s = summaries[id]
              const m = METHODS.find(x => x.id === id)
              if (!s) return null
              return (
                <div key={id} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <span className="text-lg font-black" style={{ color: m?.color }}>{m?.short}</span>
                      <span className="text-xs text-gray-400 ml-2">{m?.label}</span>
                    </div>
                    <span className="text-xs bg-teal-bg text-teal px-2 py-0.5 rounded-full font-medium">
                      ✓ Extracted
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-navy">
                        {s.nodes.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-400">nodes retained</div>
                      <div className="text-xs font-medium mt-0.5"
                        style={{ color: retentionColour(s.node_retention) }}>
                        {s.node_retention}%
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-navy">
                        {s.edges.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-400">edges retained</div>
                      <div className="text-xs font-medium mt-0.5"
                        style={{ color: retentionColour(s.edge_retention) }}>
                        {s.edge_retention}%
                      </div>
                    </div>
                  </div>

                  {/* Retention bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Edge reduction</span>
                      <span>{(100 - s.edge_retention).toFixed(1)}% removed</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{
                          width: `${s.edge_retention}%`,
                          backgroundColor: m?.color ?? '#0F6E56'
                        }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {allDone && (
        <div className="bg-teal-bg border border-teal/30 rounded-lg px-4 py-3 text-sm text-teal mb-4">
          ✅ All backbones extracted. Proceed to visual comparison.
        </div>
      )}

      {allDone && !Object.keys(summaries).length && (
        <div className="text-center mb-4">
          <Button variant="secondary" onClick={handleExtract} loading={loading}>
            ↺ Re-extract
          </Button>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => goToStep(4)}>← Back</Button>
        <Button onClick={() => goToStep(6)} disabled={!allDone}>
          Next: View Comparison →
        </Button>
      </div>
    </StepCard>
  )
}
