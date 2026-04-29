import React, { useState, useEffect } from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import { fetchVisualComparison } from '../../api/client'
import { GraphCanvas } from '../graph/GraphCanvas'
import { METHODS } from '../../constants/methods'
import { Button } from '../ui'
import PaperExportButton from '../export/PaperExportButton'
import type { VisualComparisonResponse } from '../../types'

type WorkspaceMode = 'wizard' | 'lab'
type ComparisonView = 'score' | 'if'

interface Props {
  mode?: WorkspaceMode
}

export default function VisualizationWorkspace({ mode = 'wizard' }: Props) {
  const {
    sessionId,
    datasetId,
    selectedMethods,
    backbonesReady,
    goToStep,
    setLabTab,
  } = useWorkflowStore()

  const readyMethods = selectedMethods.filter((id) => backbonesReady[id])
  const [activeMethod, setActiveMethod] = useState(readyMethods[0] ?? '')
  const [viewMode, setViewMode] = useState<ComparisonView>('score')
  const [comparison, setComparison] = useState<VisualComparisonResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (readyMethods.length === 0) {
      setActiveMethod('')
      return
    }
    if (!readyMethods.includes(activeMethod)) {
      setActiveMethod(readyMethods[0])
    }
  }, [readyMethods, activeMethod])

  useEffect(() => {
    if (!activeMethod || !sessionId) return

    setLoading(true)
    setError(null)
    fetchVisualComparison(sessionId, activeMethod)
      .then((data) => setComparison(data))
      .catch((err) => {
        console.error(err)
        setError(err?.response?.data?.detail ?? 'Could not load the full Step-6 visualization graph.')
        setComparison(null)
      })
      .finally(() => setLoading(false))
  }, [activeMethod, sessionId])

  const currentMethod = METHODS.find((x) => x.id === activeMethod)
  const methodLabel = currentMethod?.short ?? activeMethod.toUpperCase()

  const handleBack = () => {
    if (mode === 'lab') {
      setLabTab('backbone')
      return
    }
    goToStep(5)
  }

  const handleNext = () => {
    if (mode === 'lab') {
      setLabTab('exports')
      return
    }
    goToStep(7)
  }

  if (readyMethods.length === 0) {
    return (
      <div>
        <div className="text-center py-8 text-gray-400">
          No extracted backbone is ready yet. Extract at least one method first.
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={handleBack}>
            {mode === 'lab' ? '← Back to Backbone' : '← Back'}
          </Button>

          <Button onClick={handleNext} disabled>
            {mode === 'lab' ? 'Continue to Exports →' : 'Next →'}
          </Button>
        </div>
      </div>
    )
  }

  const exportTitle =
    viewMode === 'score'
      ? `${methodLabel} score-extreme original graph`
      : `${methodLabel} Isolation Forest backbone overlay`

  const exportSubtitle =
    viewMode === 'score'
      ? `Full unsampled original network. Blue edges are the lowest 20% by ${methodLabel} score; red edges are the highest 20% by ${methodLabel} score; black edges are the remaining original edges.`
      : `Full unsampled original network. Purple edges are the Isolation Forest selected ${methodLabel} backbone edges; black edges are the remaining original edges.`

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex gap-2 flex-wrap">
          {readyMethods.map((id) => {
            const mt = METHODS.find((x) => x.id === id)
            return (
              <button
                key={id}
                onClick={() => setActiveMethod(id)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                style={
                  activeMethod === id
                    ? { backgroundColor: mt?.color, color: 'white' }
                    : { backgroundColor: '#f3f4f6', color: '#374151' }
                }
              >
                {mt?.short ?? id.toUpperCase()}
              </button>
            )
          })}
        </div>

        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {(['score', 'if'] as const).map((modeOption) => (
            <button
              key={modeOption}
              onClick={() => setViewMode(modeOption)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                viewMode === modeOption
                  ? 'bg-white shadow text-navy'
                  : 'text-gray-500'
              }`}
            >
              {modeOption === 'score' ? '🔵🔴 Score extremes' : '🟣 IF backbone'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Loading full unsampled graph and shared layout…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && comparison && (
        <>
          <div className="flex gap-4 mb-4 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-black inline-block" />
              <span className="text-gray-500">
                Full original: {comparison.nodes} nodes · {comparison.edges} edges · no sampling
              </span>
            </div>

            {viewMode === 'score' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#2563EB' }} />
                  <span className="text-gray-500">Lowest 20% {methodLabel}: {comparison.low_count} edges</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#DC2626' }} />
                  <span className="text-gray-500">Highest 20% {methodLabel}: {comparison.high_count} edges</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#7C3AED' }} />
                <span className="text-gray-500">Isolation Forest backbone: {comparison.if_count} edges</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs text-gray-500 flex items-center flex-wrap gap-x-4 gap-y-2">
                {viewMode === 'score' ? (
                  <>
                    <span><span className="inline-block w-6 border-b-2 border-black mr-1 align-middle opacity-40" /> Original edges</span>
                    <span><span className="inline-block w-6 border-b-2 mr-1 align-middle" style={{ borderColor: '#2563EB' }} /> Lowest 20%</span>
                    <span><span className="inline-block w-6 border-b-2 mr-1 align-middle" style={{ borderColor: '#DC2626' }} /> Highest 20%</span>
                  </>
                ) : (
                  <>
                    <span><span className="inline-block w-6 border-b-2 border-black mr-1 align-middle opacity-40" /> Original edges</span>
                    <span><span className="inline-block w-6 border-b-2 mr-1 align-middle" style={{ borderColor: '#7C3AED' }} /> IF backbone</span>
                  </>
                )}
              </div>

              <PaperExportButton
                config={{
                  figureType: 'graph',
                  title: exportTitle,
                  filename: `${datasetId ?? 'dataset'}-${activeMethod}-${viewMode === 'score' ? 'score-extremes' : 'if-backbone-overlay'}`,
                  payload: {
                    title: exportTitle,
                    subtitle: exportSubtitle,
                    graph: comparison.graph,
                    edge_style_mode: viewMode === 'score' ? 'score_extremes' : 'if_backbone',
                    show_labels: false,
                    large_figure: true,
                  },
                }}
              />
            </div>

            <GraphCanvas
              data={comparison.graph}
              height={620}
              showLabels={false}
              edgeColorMode={viewMode === 'score' ? 'score-extremes' : 'if-backbone'}
              downloadLabel={`${activeMethod}-${viewMode}`}
            />
          </div>

          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
            💡 This Step 6 view uses the full selected network, not the Step 1 preview sample. The same fixed node positions are reused when you switch between score extremes and Isolation Forest backbone.
          </div>
        </>
      )}

      <div className="flex justify-between pt-6">
        <Button variant="secondary" onClick={handleBack}>
          {mode === 'lab' ? '← Back to Backbone' : '← Back'}
        </Button>

        <Button onClick={handleNext}>
          {mode === 'lab' ? 'Continue to Exports →' : 'Next: Evaluate →'}
        </Button>
      </div>
    </div>
  )
}
