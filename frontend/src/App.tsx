/**
 * App.tsx
 * Root component. Renders the sidebar + the active wizard step.
 */
import React from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { useWorkflowStore } from './store/workflowStore'

// Lazy-load step pages so each one only loads when needed
const Step1 = React.lazy(() => import('./pages/Step1_DataSelection'))
const Step2 = React.lazy(() => import('./pages/Step2_MethodSelection'))
const Step3 = React.lazy(() => import('./pages/Step3_ScoreComputation'))
const Step4 = React.lazy(() => import('./pages/Step4_AnomalyLabeling'))
const Step5 = React.lazy(() => import('./pages/Step5_BackboneExtraction'))
const Step6 = React.lazy(() => import('./pages/Step6_VisualComparison'))
const Step7 = React.lazy(() => import('./pages/Step7_Evaluation'))

const STEP_COMPONENTS: Record<number, React.ComponentType> = {
  1: Step1, 2: Step2, 3: Step3, 4: Step4,
  5: Step5, 6: Step6, 7: Step7,
}

export default function App() {
  const { currentStep } = useWorkflowStore()
  const StepPage = STEP_COMPONENTS[currentStep] ?? Step1

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      {/* Main content area */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {/* Top header bar */}
        <div className="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-navy">
            Network Backbone Explorer
          </h1>
          <div className="text-xs text-gray-400">
            Step {currentStep} of 7
          </div>
        </div>

        {/* Step content */}
        <div className="max-w-5xl mx-auto px-6 py-8">
          <React.Suspense fallback={
            <div className="flex items-center justify-center h-64 text-gray-400">
              <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Loading…
            </div>
          }>
            <StepPage />
          </React.Suspense>
        </div>
      </main>
    </div>
  )
}
