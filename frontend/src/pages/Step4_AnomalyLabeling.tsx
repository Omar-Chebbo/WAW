import React, { useEffect } from 'react'
import { StepCard, Button } from '../components/ui'
import { useWorkflowStore } from '../store/workflowStore'
import { METHODS } from '../constants/methods'
import AnomalyLabelingWorkspace from '../components/lab/AnomalyLabelingWorkspace'
import type { MethodId, PreprocessingMode } from '../types'

const PREPROCESSING_OPTIONS: {
  id: PreprocessingMode
  label: string
  description: string
}[] = [
  {
    id: 'none',
    label: 'None',
    description: 'Use raw scores without preprocessing.',
  },
  {
    id: 'log',
    label: 'Log',
    description: 'Compress skewed values using a log transform.',
  },
  {
    id: 'minmax',
    label: 'Min-max',
    description: 'Scale values into a 0 to 1 range.',
  },
  {
    id: 'zscore',
    label: 'Z-score',
    description: 'Center values using mean and standard deviation.',
  },
  {
    id: 'log_minmax',
    label: 'Log + Min-max',
    description: 'First compress skew, then normalize to 0 to 1.',
  },
]

const PREPROCESSING_METHODS: MethodId[] = ['pa', 'lp']

export default function Step4() {
  const {
    selectedMethods,
    scoresReady,
    preprocessingByMethod,
    setPreprocessingMode,
    goToStep,
  } = useWorkflowStore()

  const relevantMethods = METHODS.filter(
    (m) => selectedMethods.includes(m.id) && m.requires_anomaly
  )

  const preprocessingMethods = relevantMethods.filter((m) =>
    PREPROCESSING_METHODS.includes(m.id)
  )

  useEffect(() => {
    if (scoresReady && relevantMethods.length === 0) {
      goToStep(5)
    }
  }, [scoresReady, relevantMethods.length, goToStep])

  const allChosen =
    preprocessingMethods.length === 0 ||
    preprocessingMethods.every((m) => !!preprocessingByMethod[m.id])

  return (
    <StepCard
      stepNumber={4}
      title="Anomaly Labeling"
      subtitle="First choose the preprocessing for PA and LP, then run anomaly labeling."
    >
      {preprocessingMethods.length > 0 && (
        <div className="space-y-6 mb-8">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
            <div className="text-sm font-semibold text-blue-900 mb-1">
              Choose preprocessing before anomaly detection
            </div>
            <p className="text-sm text-blue-800">
              The user must choose preprocessing manually. No automatic recommendation is used here.
            </p>
          </div>

          {preprocessingMethods.map((method) => {
            const selectedMode = preprocessingByMethod[method.id]

            return (
              <div
                key={method.id}
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="text-base font-bold text-navy">
                      {method.short} — {method.label}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Select the preprocessing that should be applied before anomaly detection.
                    </p>
                  </div>

                  <span
                    className="px-3 py-1 rounded-full text-white text-xs font-semibold"
                    style={{ backgroundColor: method.color }}
                  >
                    {selectedMode ? `Selected: ${selectedMode}` : 'Not selected'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PREPROCESSING_OPTIONS.map((option) => {
                    const active = selectedMode === option.id

                    return (
                      <button
                        key={option.id}
                        onClick={() => setPreprocessingMode(method.id, option.id)}
                        className={
                          active
                            ? 'text-left rounded-xl border p-4 transition-all border-teal bg-teal/5 ring-1 ring-teal'
                            : 'text-left rounded-xl border p-4 transition-all border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                        }
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="text-sm font-semibold text-navy">
                            {option.label}
                          </span>

                          {active && (
                            <span className="text-xs font-semibold text-teal">
                              Selected
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-gray-500">
                          {option.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!allChosen ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="text-sm font-semibold text-amber-800 mb-1">
            Preprocessing selection required
          </div>
          <p className="text-sm text-amber-700">
            Choose preprocessing for every required method above to continue with anomaly labeling.
          </p>

          <div className="flex justify-between pt-6">
            <Button variant="secondary" onClick={() => goToStep(3)}>
              ← Back
            </Button>

            <Button disabled>
              Next: Extract Backbone →
            </Button>
          </div>
        </div>
      ) : (
        <AnomalyLabelingWorkspace mode="wizard" />
      )}
    </StepCard>
  )
}