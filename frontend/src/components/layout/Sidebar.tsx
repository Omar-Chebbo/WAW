/**
 * components/layout/Sidebar.tsx
 * The left navigation panel showing all 7 wizard steps.
 */
import React from 'react'
import clsx from 'clsx'
import { CheckCircle, Circle, Lock, FlaskConical, List } from 'lucide-react'
import { useWorkflowStore } from '../../store/workflowStore'
import type { WizardStep } from '../../types'

const STEPS = [
  { n: 1 as WizardStep, label: 'Data Selection' },
  { n: 2 as WizardStep, label: 'Method Selection' },
  { n: 3 as WizardStep, label: 'Score Computation' },
  { n: 4 as WizardStep, label: 'Anomaly Labeling' },
  { n: 5 as WizardStep, label: 'Backbone Extraction' },
  { n: 6 as WizardStep, label: 'Visual Comparison' },
  { n: 7 as WizardStep, label: 'Evaluation' },
]

export function Sidebar() {
    const {
    currentStep,
    currentView,
    goToStep,
    setView,
    openExperimentLab,
    datasetId,
    selectedMethods,
    scoresReady,
    anomaliesReady,
    backbonesReady,
    resetSession,
  } = useWorkflowStore()

  // A step is "unlocked" if all its prerequisites are met
  function isUnlocked(n: WizardStep) {
    if (n === 1) return true
    if (n === 2) return !!datasetId
    if (n === 3) return selectedMethods.length > 0
    if (n === 4) return scoresReady
    if (n === 5) return scoresReady  // anomaly step may be skipped
    if (n === 6) return Object.values(backbonesReady).some(Boolean)
    if (n === 7) return Object.values(backbonesReady).some(Boolean)
    return false
  }

  return (
    <aside className="w-64 bg-navy min-h-screen flex flex-col py-8 px-4 flex-shrink-0">
      {/* Logo */}
      <div className="mb-10 px-2">
        <div className="text-white font-bold text-lg leading-tight">Network Backbone</div>
        <div className="text-teal-bg text-xs opacity-70">Explorer</div>
      </div>

            <div className="mb-6 grid grid-cols-2 gap-2 px-2">
        <button
          onClick={() => setView('wizard')}
          className={clsx(
            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
            currentView === 'wizard'
              ? 'bg-white text-navy'
              : 'bg-white/10 text-gray-300 hover:bg-white/15'
          )}
        >
          <List size={14} />
          Wizard
        </button>

        <button
          onClick={() => openExperimentLab('contamination')}
          className={clsx(
            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
            currentView === 'lab'
              ? 'bg-teal text-white'
              : 'bg-white/10 text-gray-300 hover:bg-white/15'
          )}
        >
          <FlaskConical size={14} />
          Lab
        </button>
      </div>


      {/* Step list */}
      <nav className="flex flex-col gap-1">
        {STEPS.map(({ n, label }) => {
          const unlocked = isUnlocked(n)
          const active   = currentStep === n
          const done     = currentStep > n && unlocked

          return (
            <button
              key={n}
              onClick={() => {
                if (!unlocked) return
                setView('wizard')
                goToStep(n)
              }}
              disabled={!unlocked}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-all',
                active   && 'bg-teal text-white font-semibold',
                !active && unlocked  && 'text-gray-300 hover:bg-white/10',
                !unlocked && 'text-gray-600 cursor-not-allowed'
              )}
            >
              <span className="w-5 h-5 flex-shrink-0">
                {done      ? <CheckCircle size={18} className="text-teal-bg" /> :
                 active    ? <Circle size={18} className="text-white fill-white" /> :
                 unlocked  ? <Circle size={18} /> :
                             <Lock size={14} className="text-gray-600" />}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs opacity-60">{n}.</span>
                {label}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Reset button */}
      <div className="mt-auto px-2">
        <button
          onClick={() => resetSession()}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ↺ Start new session
        </button>
      </div>
    </aside>
  )
}
