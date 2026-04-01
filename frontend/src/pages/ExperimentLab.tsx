import React from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { Button } from '../components/ui'
import ResearchAnalysisPanel from '../components/research/ResearchAnalysisPanel'

export default function ExperimentLab() {
  const { sessionId, setView, goToStep } = useWorkflowStore()

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-navy">Research Analysis Lab</h2>
            <p className="text-sm text-gray-500 mt-1">
              Independent from the wizard. This page contains only the research analysis panel.
            </p>
            <div className="mt-3 text-xs text-gray-400">
              Session: <span className="font-mono">{sessionId}</span>
            </div>
          </div>

          <Button
            variant="secondary"
            onClick={() => {
              setView('wizard')
              goToStep(7)
            }}
          >
            Open Wizard
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <ResearchAnalysisPanel />
      </div>
    </div>
  )
}