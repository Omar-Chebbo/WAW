import React from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import { Button } from '../ui'

export default function ExportsWorkspace() {
  const { setLabTab, setView, goToStep } = useWorkflowStore()

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="text-base font-bold text-navy mb-1">
          Export shortcuts
        </div>
        <p className="text-sm text-gray-500">
          Use the buttons below to jump directly to the place where each export is available.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-navy mb-1">
            Graph exports
          </div>
          <p className="text-sm text-gray-500 mb-4">
            High-quality SVG and PNG 4x for original, backbone, and overlay graph views.
          </p>
          <Button onClick={() => setLabTab('visualization')}>
            Open Visualization
          </Button>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-navy mb-1">
            Histogram exports
          </div>
          <p className="text-sm text-gray-500 mb-4">
            High-quality SVG and PNG 4x for anomaly score distributions.
          </p>
          <Button onClick={() => setLabTab('labeling')}>
            Open Labeling
          </Button>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-navy mb-1">
            Evaluation exports
          </div>
          <p className="text-sm text-gray-500 mb-4">
            CSV export and chart exports from the evaluation page.
          </p>
          <Button
            onClick={() => {
              setView('wizard')
              goToStep(7)
            }}
          >
            Open Evaluation
          </Button>
        </div>
      </div>
    </div>
  )
}