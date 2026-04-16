import React from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { Button } from '../components/ui'
import ResearchAnalysisPanel from '../components/research/ResearchAnalysisPanel'
import ContaminationExperimentPanel from '../components/research/ContaminationExperimentPanel'
import MultiFeatureExperimentPanel from '../components/research/MultiFeatureExperimentPanel'

export default function ExperimentLab() {
  const { sessionId, labTab, setLabTab, setView, goToStep } = useWorkflowStore()

  const activeTab = labTab === 'contamination' || labTab === 'multi_feature' ? labTab : 'preprocessing'

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-navy">Experiment Lab</h2>
            <p className="text-sm text-gray-500 mt-1">
              Independent from the wizard. Preprocessing, contamination, and multi-feature studies live here as separate research tracks.
            </p>
            <div className="mt-3 text-xs text-gray-400">
              Session: <span className="font-mono">{sessionId}</span>
            </div>
          </div>

          <Button
            variant="secondary"
            onClick={() => {
              setView('wizard')
              goToStep(4)
            }}
          >
            Open Wizard Step 4
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setLabTab('preprocessing')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'preprocessing'
                ? 'bg-navy text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Preprocessing Study
          </button>

          <button
            onClick={() => setLabTab('contamination')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'contamination'
                ? 'bg-teal text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Contamination Study
          </button>


          <button
            onClick={() => setLabTab('multi_feature')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'multi_feature'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Multi-Feature Study
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        {activeTab === 'contamination' ? <ContaminationExperimentPanel /> : activeTab === 'multi_feature' ? <MultiFeatureExperimentPanel /> : <ResearchAnalysisPanel />}
      </div>
    </div>
  )
}
