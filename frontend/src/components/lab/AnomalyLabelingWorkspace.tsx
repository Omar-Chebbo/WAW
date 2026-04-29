import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import {
  runAnomalyLabeling,
  fetchAnomalyInspector,
} from '../../api/client'
import { METHODS } from '../../constants/methods'
import { Button } from '../ui'
import type { AnomalySummary, AnomalyInspector } from '../../types'
import ContaminationControl from './ContaminationControl'
import AnomalyStatsCards from './AnomalyStatsCards'
import ScoreInspectorSection from './ScoreInspectorSection'

type WorkspaceMode = 'wizard' | 'lab'
type ControlMode = 'auto' | 'manual'

interface Props {
  mode?: WorkspaceMode
}

interface MethodControlState {
  mode: ControlMode
  draftValue: number
}

interface MethodAppliedState {
  mode: ControlMode
  contamination?: number | null
}

interface PreviousRunInfo {
  mode: ControlMode
  contaminationLabel: string
  threshold?: number | null
  flagged?: number
}

async function fetchLabeledRows(sessionId: string, methodId: string) {
  const res = await fetch(`/api/anomalies/${sessionId}/${methodId}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch labeled rows for ${methodId}`)
  }
  return res.json()
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
  } = useWorkflowStore()

  const relevantMethods = METHODS.filter(
    (m) => selectedMethods.includes(m.id) && m.requires_anomaly
  )

  const [activeTab, setActiveTab] = useState(relevantMethods[0]?.id ?? '')
  const [summaries, setSummaries] = useState<Record<string, AnomalySummary>>({})
  const [inspectors, setInspectors] = useState<Record<string, AnomalyInspector>>({})
  const [rowsByMethod, setRowsByMethod] = useState<Record<string, Record<string, any>[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [controls, setControls] = useState<Record<string, MethodControlState>>({})
  const [appliedStates, setAppliedStates] = useState<Record<string, MethodAppliedState>>({})
  const [previousRuns, setPreviousRuns] = useState<Record<string, PreviousRunInfo | null>>({})

  const inFlightRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    if (mode === 'wizard' && scoresReady && relevantMethods.length === 0) {
      goToStep(5)
    }
  }, [mode, scoresReady, relevantMethods.length, goToStep])

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

  function getControl(methodId: string): MethodControlState {
    return controls[methodId] ?? { mode: 'manual', draftValue: 0.1 }
  }

  function updateControl(methodId: string, patch: Partial<MethodControlState>) {
    const current = getControl(methodId)
    setControls((state) => ({
      ...state,
      [methodId]: { ...current, ...patch },
    }))
  }

  const applyIsolationForestRun = useCallback(
    async (methodId: string, requestedMode?: ControlMode) => {
      if (inFlightRef.current[methodId]) return
      inFlightRef.current[methodId] = true
      setLoading((state) => ({ ...state, [methodId]: true }))

      try {
        const selectedPreprocessing = preprocessingByMethod[methodId] ?? 'none'
        // PA+LP has no separate preprocessing card in the wizard; it uses raw PA and LP scores by default.

        const control = getControl(methodId)
        const finalMode = requestedMode ?? control.mode
        const contamination = control.draftValue

        const currentSummary = summaries[methodId]
        const currentApplied = appliedStates[methodId]

        if (currentSummary || currentApplied) {
          setPreviousRuns((prev) => ({
            ...prev,
            [methodId]: {
              mode: currentApplied?.mode ?? 'manual',
              contaminationLabel:
                (currentApplied?.contamination ?? control.draftValue).toFixed(2),
              threshold: currentSummary?.cutoff_rank ?? null,
              flagged: currentSummary?.flagged,
            },
          }))
        }

        const res = await runAnomalyLabeling(
          sessionId,
          methodId,
          selectedPreprocessing,
          contamination
        )

        const [inspector, rows] = await Promise.all([
          fetchAnomalyInspector(sessionId, methodId),
          fetchLabeledRows(sessionId, methodId),
        ])

        setSummaries((state) => ({ ...state, [methodId]: res.summary }))
        setInspectors((state) => ({ ...state, [methodId]: inspector }))
        setRowsByMethod((state) => ({ ...state, [methodId]: rows }))
        setAppliedStates((state) => ({
          ...state,
          [methodId]: {
            mode: finalMode,
            contamination: control.draftValue,
          },
        }))
        setAnomalyReady(methodId, true)
      } catch (error) {
        console.error(error)
      } finally {
        inFlightRef.current[methodId] = false
        setLoading((state) => ({ ...state, [methodId]: false }))
      }
    },
    [sessionId, preprocessingByMethod, summaries, appliedStates, controls, setAnomalyReady]
  )

  const allDone = relevantMethods.every((m) => anomaliesReady[m.id])

  const handleBack = () => {
    goToStep(3)
  }

  const handleNext = () => {
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
            ← Back
          </Button>

          <Button onClick={handleNext}>
            Next →
          </Button>
        </div>
      </div>
    )
  }

  const visibleMethods =
    relevantMethods.length === 1
      ? relevantMethods
      : relevantMethods.filter((method) => method.id === activeTab)

  return (
    <div>
      {relevantMethods.length > 1 && (
        <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
          {relevantMethods.map((method) => (
            <button
              key={method.id}
              onClick={() => setActiveTab(method.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === method.id
                  ? 'text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
              style={activeTab === method.id ? { backgroundColor: method.color } : {}}
            >
              {method.short}
            </button>
          ))}
        </div>
      )}

      {visibleMethods.map((method) => {
        const summary = summaries[method.id]
        const inspector = inspectors[method.id]
        const rows = rowsByMethod[method.id] ?? []
        const isLoading = loading[method.id]
        const selectedPreprocessing = preprocessingByMethod[method.id] ?? 'none'
        const control = getControl(method.id)
        const applied = appliedStates[method.id] ?? { mode: 'manual' as ControlMode, contamination: 0.1 }

        const isDirectThreshold = method.selection_method === 'direct_high' || method.selection_method === 'direct_low'
        // Direct threshold methods don't need preprocessing — they always use raw scores
        const preprocessingReady = isDirectThreshold || !!selectedPreprocessing
        const loadingLabel = isDirectThreshold
          ? `Running Direct Thresholding (${method.short})…`
          : 'Running Isolation Forest…'

        return (
          <div key={method.id}>
            {isLoading && (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
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
                <span>{loadingLabel}</span>
              </div>
            )}

            {!preprocessingReady && !isLoading && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-4">
                <div className="text-sm font-semibold text-amber-800 mb-1">
                  Preprocessing not selected yet
                </div>
                <p className="text-sm text-amber-700">
                  Choose a preprocessing mode first before anomaly labeling can run for {method.short}.
                </p>
              </div>
            )}

            {!isLoading && preprocessingReady && (
              <ContaminationControl
                mode={control.mode}
                appliedMode={applied.mode}
                draftValue={control.draftValue}
                appliedValue={applied.contamination}
                selectionMethod={method.selection_method}
                onModeChange={(newMode) => updateControl(method.id, { mode: newMode })}
                onDraftChange={(newValue) => updateControl(method.id, { draftValue: newValue })}
                onApply={() => applyIsolationForestRun(method.id)}
                onResetDraft={() => updateControl(method.id, { mode: 'manual', draftValue: 0.1 })}
              />
            )}

            {summary && !isLoading && (
              <AnomalyStatsCards summary={summary} color={method.color} />
            )}

            {inspector && !isLoading && rows.length > 0 && (
              <ScoreInspectorSection
                inspector={inspector}
                methodColor={method.color}
                rows={rows}
                previousRun={previousRuns[method.id] ?? null}
              />
            )}

            {anomaliesReady[method.id] && !isLoading && (
              <div className="flex items-center gap-2 text-sm text-teal mb-4">
                <span>✅</span>
                <span>Labeling complete for {method.short}</span>
              </div>
            )}
          </div>
        )
      })}

      <div className="flex justify-between pt-6">
        <Button variant="secondary" onClick={handleBack}>
          ← Back
        </Button>

        <Button onClick={handleNext} disabled={!allDone}>
          Next: Extract Backbone →
        </Button>
      </div>
    </div>
  )
}
