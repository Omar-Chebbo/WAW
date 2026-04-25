/**
 * pages/Step3_ScoreComputation.tsx
 * Triggers score computation and shows real-time WebSocket progress.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { fetchScoreStatus, triggerCompute } from '../api/client'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'
import type { ScoreCacheStatusResponse, ScoreStrategy } from '../types'

function statusLabel(status?: string) {
  if (status === 'cached') return 'Saved score exists'
  if (status === 'derivable') return 'Can be built from saved PA + LP'
  return 'No saved score yet'
}

export default function Step3() {
  const {
    sessionId,
    datasetId,
    isCustomDataset,
    selectedMethods,
    scoresReady,
    setScoresReady,
    goToStep,
  } = useWorkflowStore()

  const [computing, setComputing] = useState(false)
  const [done, setDone] = useState(scoresReady)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [statusMsg, setStatusMsg] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [scoreStrategy, setScoreStrategy] = useState<ScoreStrategy>('reuse')
  const [cacheStatus, setCacheStatus] = useState<ScoreCacheStatusResponse | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)

  const anySavedScores = useMemo(() => {
    if (!cacheStatus) return false
    return selectedMethods.some((methodId) => cacheStatus.methods[methodId]?.exists)
  }, [cacheStatus, selectedMethods])

  useEffect(() => {
    let cancelled = false
    async function loadStatus() {
      if (!datasetId || selectedMethods.length === 0) {
        setCacheStatus(null)
        return
      }
      setLoadingStatus(true)
      try {
        const data = await fetchScoreStatus(datasetId, selectedMethods, isCustomDataset)
        if (!cancelled) setCacheStatus(data)
      } catch {
        if (!cancelled) setCacheStatus(null)
      } finally {
        if (!cancelled) setLoadingStatus(false)
      }
    }
    loadStatus()
    return () => {
      cancelled = true
    }
  }, [datasetId, selectedMethods, isCustomDataset])

  // Subscribe to WebSocket progress events from the backend
  useEffect(() => {
    if (!sessionId) return
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/${sessionId}`)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string
          method?: string
          progress?: number
          message?: string
          cache_status?: ScoreCacheStatusResponse
        }
        if (msg.type === 'progress' && msg.method) {
          setProgress((p) => ({ ...p, [msg.method!]: msg.progress ?? 0 }))
          setStatusMsg((p) => ({ ...p, [msg.method!]: msg.message ?? '' }))
        }
        if (msg.type === 'complete') {
          const full: Record<string, number> = {}
          selectedMethods.forEach((id) => {
            full[id] = 100
          })
          setProgress(full)
          setDone(true)
          setScoresReady(true)
          setComputing(false)
          if (msg.cache_status) setCacheStatus(msg.cache_status)
        }
        if (msg.type === 'error') {
          setError(msg.message ?? 'Unknown error')
          setComputing(false)
        }
      } catch {
        /* ignore */
      }
    }

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 25_000)

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [sessionId, selectedMethods, setScoresReady])

  async function handleCompute() {
    if (!sessionId || !datasetId) return
    setComputing(true)
    setDone(false)
    setError(null)
    setProgress({})
    setStatusMsg({})
    try {
      await triggerCompute(sessionId, datasetId, selectedMethods, isCustomDataset, scoreStrategy)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to start computation.')
      setComputing(false)
    }
  }

  return (
    <StepCard
      stepNumber={3}
      title="Compute Scores"
      subtitle="Save PA / LP scores once per dataset, then reuse them across the wizard and experiment labs."
    >
      <div className="flex flex-wrap gap-2 mb-8">
        {selectedMethods.map((id) => {
          const m = METHODS.find((x) => x.id === id)
          const status = cacheStatus?.methods[id]
          return (
            <div key={id} className="px-3 py-2 rounded-xl border border-gray-100 bg-white shadow-sm min-w-[180px]">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-white text-xs font-semibold" style={{ backgroundColor: m?.color ?? '#999' }}>
                  {m?.short ?? id}
                </span>
                <span className="text-sm font-semibold text-navy">{m?.label}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {loadingStatus ? 'Checking saved scores…' : statusLabel(status?.status)}
              </div>
            </div>
          )
        })}
      </div>

      {!computing && !done && (
        <div className="space-y-6">
          <div className="text-center py-4">
            <div className="text-4xl mb-4">⚙️</div>
            <p className="text-gray-500 text-sm max-w-2xl mx-auto">
              The project now saves scores by dataset. First time is slower. Later runs can reuse the saved PA / LP scores.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5">
            <div className="text-sm font-semibold text-navy mb-3">Choose how to handle saved scores</div>
            <div className="space-y-3 text-sm text-gray-600">
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${scoreStrategy === 'reuse' ? 'border-teal bg-teal/5' : 'border-gray-200'}`}>
                <input type="radio" checked={scoreStrategy === 'reuse'} onChange={() => setScoreStrategy('reuse')} className="mt-1" />
                <div>
                  <div className="font-semibold text-navy">Reuse saved scores when they exist</div>
                  <div className="text-xs text-gray-500">Recommended. Missing scores will still be computed once and then saved.</div>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${scoreStrategy === 'recompute' ? 'border-coral bg-coral/5' : 'border-gray-200'}`}>
                <input type="radio" checked={scoreStrategy === 'recompute'} onChange={() => setScoreStrategy('recompute')} className="mt-1" />
                <div>
                  <div className="font-semibold text-navy">Recalculate everything</div>
                  <div className="text-xs text-gray-500">Use this only when you changed the scoring logic or want to replace the saved cache.</div>
                </div>
              </label>
            </div>
          </div>

          <div className={`rounded-xl border px-4 py-3 text-sm ${anySavedScores ? 'border-teal/30 bg-teal/5 text-teal' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            {anySavedScores
              ? 'Saved scores were found for this dataset. You can reuse them or recalculate them.'
              : 'No saved scores were found for these selected methods yet. The project will calculate them now and save them for future use.'}
          </div>

          <div className="text-center">
            <Button onClick={handleCompute}>▶ Start</Button>
          </div>
        </div>
      )}

      {(computing || done) && (
        <div className="space-y-5 mb-6">
          {selectedMethods.map((id) => {
            const m = METHODS.find((x) => x.id === id)
            const pct = done ? 100 : progress[id] ?? 0
            const msg = statusMsg[id] ?? (done ? 'Ready ✓' : 'Starting…')
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
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: m?.color ?? '#0F6E56' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {done && (
        <div className="bg-teal-bg border border-teal/30 rounded-lg px-4 py-3 text-sm text-teal mb-4 flex gap-2">
          <span>✅</span>
          <span>All requested score files are ready and saved.</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          ❌ {error}
        </div>
      )}

      {done && (
        <div className="text-center mb-4">
          <button onClick={handleCompute} className="text-xs text-gray-400 hover:text-gray-600 underline">
            Run again with the current choice
          </button>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => goToStep(2)}>
          ← Back
        </Button>

        <Button onClick={() => goToStep(4)} disabled={!done}>
          Next →
        </Button>
      </div>
    </StepCard>
  )
}
