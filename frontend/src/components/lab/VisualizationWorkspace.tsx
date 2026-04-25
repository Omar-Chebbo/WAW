import React, { useState, useEffect, useMemo } from 'react'
import { useWorkflowStore } from '../../store/workflowStore'
import { fetchDatasetPreview, fetchBackbone } from '../../api/client'
import { GraphCanvas } from '../graph/GraphCanvas'
import { METHODS } from '../../constants/methods'
import { Button } from '../ui'
import PaperExportButton from '../export/PaperExportButton'
import type { GraphData } from '../../types'

type WorkspaceMode = 'wizard' | 'lab'

interface Props {
  mode?: WorkspaceMode
}

export default function VisualizationWorkspace({
  mode = 'wizard',
}: Props) {
  const {
    sessionId,
    datasetId,
    isCustomDataset,
    selectedMethods,
    backbonesReady,
    goToStep,
    setLabTab,
  } = useWorkflowStore()

  const readyMethods = selectedMethods.filter((id) => backbonesReady[id])
  const [activeMethod, setActiveMethod] = useState(readyMethods[0] ?? '')
  const [viewMode, setViewMode] = useState<'side' | 'overlay'>('side')
  const [original, setOriginal] = useState<GraphData | null>(null)
  const [backbone, setBackbone] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (readyMethods.length === 0) {
      setActiveMethod('')
      return
    }

    if (!readyMethods.includes(activeMethod)) {
      setActiveMethod(readyMethods[0])
    }
  }, [readyMethods, activeMethod])

  const backboneEdgeSet = useMemo(() => {
    if (!backbone) return undefined

    const s = new Set<string>()
    backbone.links.forEach((l) => {
      const src = typeof l.source === 'object' ? (l.source as any).id : String(l.source)
      const tgt = typeof l.target === 'object' ? (l.target as any).id : String(l.target)
      const key = src < tgt ? `${src}--${tgt}` : `${tgt}--${src}`
      s.add(key)
    })
    return s
  }, [backbone])

  useEffect(() => {
    if (!activeMethod || !datasetId || !sessionId) return

    setLoading(true)

    Promise.all([
      fetchDatasetPreview(datasetId, isCustomDataset),
      fetchBackbone(sessionId, activeMethod),
    ])
      .then(([orig, back]) => {
        setOriginal(orig)
        setBackbone(back)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeMethod, sessionId, datasetId, isCustomDataset])

  const currentMethod = METHODS.find((x) => x.id === activeMethod)

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
                {mt?.short}
              </button>
            )
          })}
        </div>

        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {(['side', 'overlay'] as const).map((modeOption) => (
            <button
              key={modeOption}
              onClick={() => setViewMode(modeOption)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                viewMode === modeOption
                  ? 'bg-white shadow text-navy'
                  : 'text-gray-500'
              }`}
            >
              {modeOption === 'side' ? '⬜⬜ Side by side' : '⬛ Overlay'}
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
          Loading graph data…
        </div>
      )}

      {!loading && original && backbone && (
        <>
          <div className="flex gap-4 mb-4 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-300 inline-block" />
              <span className="text-gray-500">
                Original: {original.nodes.length} nodes · {original.links.length} edges
                {original.sampled && ' (sampled)'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: currentMethod?.color }}
              />
              <span className="text-gray-500">
                {currentMethod?.short} Backbone: {backbone.nodes.length} nodes · {backbone.links.length} edges
              </span>
            </div>
          </div>

          {viewMode === 'side' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Original Graph</div>
                  <PaperExportButton config={{ figureType: 'graph', title: 'Original graph', filename: `${datasetId}-original-graph`, payload: { title: 'Original graph', subtitle: original.sampled ? 'Preview graph sampled for interface performance.' : 'Original graph.', graph: original } }} />
                </div>

                <GraphCanvas
                  data={original}
                  height={420}
                  showLabels={true}
                  downloadLabel="original-graph"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: currentMethod?.color }}
                  >
                    {currentMethod?.short} Backbone
                  </div>
                  <PaperExportButton config={{ figureType: 'graph', title: `${currentMethod?.short ?? activeMethod} backbone`, filename: `${datasetId}-${activeMethod}-backbone`, payload: { title: `${currentMethod?.short ?? activeMethod} backbone`, subtitle: 'Extracted backbone graph.', graph: backbone, accent_color: currentMethod?.color, show_labels: true } }} />
                </div>

                <GraphCanvas
                  data={backbone}
                  accentColor={currentMethod?.color}
                  height={420}
                  showLabels={true}
                  downloadLabel={`backbone-${activeMethod}`}
                />
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-xs text-gray-400">
                  <span className="inline-block w-6 border-b-2 border-gray-300 mr-1 align-middle" />
                  Removed edges (grey)
                  <span
                    className="inline-block w-6 border-b-2 ml-4 mr-1 align-middle"
                    style={{ borderColor: currentMethod?.color }}
                  />
                  Backbone edges
                </div>
                <PaperExportButton config={{ figureType: 'graph', title: `${currentMethod?.short ?? activeMethod} overlay`, filename: `${datasetId}-${activeMethod}-overlay`, payload: { title: `${currentMethod?.short ?? activeMethod} overlay`, subtitle: 'Original graph with the extracted backbone edges highlighted.', graph: original, highlight_edges: Array.from(backboneEdgeSet ?? []), accent_color: currentMethod?.color } }} />
              </div>

              <GraphCanvas
                data={original}
                backboneEdgeSet={backboneEdgeSet}
                accentColor={currentMethod?.color}
                height={500}
                showLabels={false}
                downloadLabel={`overlay-${activeMethod}`}
              />
            </div>
          )}

          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
            💡 Scroll to zoom · Drag nodes to reposition · Drag background to pan
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