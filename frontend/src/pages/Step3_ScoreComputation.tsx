/**
 * pages/Step3_ScoreComputation.tsx
 * Triggers score computation and shows real-time WebSocket progress.
 */
import React, { useState, useEffect } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { triggerCompute } from '../api/client'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'

export default function Step3() {
  const {
    sessionId, datasetId, isCustomDataset, selectedMethods,
    scoresReady, setScoresReady, goToStep
  } = useWorkflowStore()

  const [computing, setComputing] = useState(false)
  const [done,      setDone]      = useState(scoresReady)
  const [progress,  setProgress]  = useState<Record<string, number>>({})
  const [statusMsg, setStatusMsg] = useState<Record<string, string>>({})
  const [error,     setError]     = useState<string | null>(null)

  // Subscribe to WebSocket progress events from the backend
  useEffect(() => {
    if (!sessionId) return
    const ws = new WebSocket(`ws://${window.location.host}/ws/${sessionId}`)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string; method?: string; progress?: number; message?: string
        }
        if (msg.type === 'progress' && msg.method) {
          setProgress(p => ({ ...p, [msg.method!]: msg.progress ?? 0 }))
          setStatusMsg(p => ({ ...p, [msg.method!]: msg.message ?? '' }))
        }
        if (msg.type === 'complete') {
          const full: Record<string, number> = {}
          selectedMethods.forEach(id => { full[id] = 100 })
          setProgress(full)
          setDone(true)
          setScoresReady(true)
          setComputing(false)
        }
        if (msg.type === 'error') {
          setError(msg.message ?? 'Unknown error')
          setComputing(false)
        }
      } catch { /* ignore */ }
    }

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 25_000)

    return () => { clearInterval(ping); ws.close() }
  }, [sessionId, selectedMethods, setScoresReady])

  async function handleCompute() {
    if (!sessionId || !datasetId) return
    setComputing(true)
    setDone(false)
    setError(null)
    setProgress({})
    setStatusMsg({})
    try {
      await triggerCompute(sessionId, datasetId, selectedMethods, isCustomDataset)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      setError(detail ?? 'Failed to start computation.')
      setComputing(false)
    }
  }

  return (
    <StepCard stepNumber={3} title="Compute Scores"
      subtitle="Calculate backbone scores for each selected method. Progress updates in real time.">

      <div className="flex flex-wrap gap-2 mb-8">
        {selectedMethods.map(id => {
          const m = METHODS.find(x => x.id === id)
          return (
            <span key={id} className="px-3 py-1 rounded-full text-white text-sm font-semibold"
              style={{ backgroundColor: m?.color ?? '#999' }}>
              {m?.short ?? id} — {m?.label}
            </span>
          )
        })}
      </div>

      {!computing && !done && (
        <div className="text-center py-10">
          <div className="text-4xl mb-4">⚙️</div>
          <p className="text-gray-500 text-sm mb-6">
            Ready to compute scores for <strong>{selectedMethods.length}</strong>{' '}
            method{selectedMethods.length !== 1 ? 's' : ''}.
            Large graphs may take a few minutes.
          </p>
          <Button onClick={handleCompute}>▶ Compute Scores</Button>
        </div>
      )}

      {(computing || done) && (
        <div className="space-y-5 mb-6">
          {selectedMethods.map(id => {
            const m   = METHODS.find(x => x.id === id)
            const pct = done ? 100 : (progress[id] ?? 0)
            const msg = statusMsg[id] ?? (done ? 'Complete ✓' : 'Starting…')
            return (
              <div key={id}>
                <div className="flex justify-between items-center text-sm mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold" style={{ color: m?.color }}>{m?.short}</span>
                    <span className="text-gray-400 text-xs truncate max-w-xs">{msg}</span>
                  </div>
                  <span className="font-medium text-gray-600">{pct}%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: m?.color ?? '#0F6E56' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {done && (
        <div className="bg-teal-bg border border-teal/30 rounded-lg px-4 py-3 text-sm text-teal mb-4 flex gap-2">
          <span>✅</span><span>All scores computed and saved.</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          ❌ {error}
        </div>
      )}

      {done && (
        <div className="text-center mb-4">
          <button onClick={handleCompute}
            className="text-xs text-gray-400 hover:text-gray-600 underline">
            Recompute scores
          </button>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => goToStep(2)}>← Back</Button>
        <Button onClick={() => goToStep(4)} disabled={!done}>Next →</Button>
      </div>
    </StepCard>
  )
}
