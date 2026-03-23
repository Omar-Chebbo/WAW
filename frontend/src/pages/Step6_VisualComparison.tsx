/**
 * pages/Step6_VisualComparison.tsx
 * Side-by-side (or overlay) D3 graph view for original vs backbone.
 * Supports method tabs, zoom/pan, and a download-as-PNG button.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { fetchDatasetPreview, fetchBackbone } from '../api/client'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'
import type { GraphData } from '../types'

export default function Step6() {
  const {
    sessionId, datasetId, isCustomDataset,
    selectedMethods, backbonesReady, goToStep
  } = useWorkflowStore()

  const [activeMethod,  setActiveMethod]  = useState(selectedMethods[0] ?? '')
  const [viewMode,      setViewMode]      = useState<'side' | 'overlay'>('side')
  const [original,      setOriginal]      = useState<GraphData | null>(null)
  const [backbone,      setBackbone]      = useState<GraphData | null>(null)
  const [loading,       setLoading]       = useState(false)

  // Build the set of backbone edge keys for overlay highlighting
  const backboneEdgeSet = useMemo(() => {
    if (!backbone) return undefined
    const s = new Set<string>()
    backbone.links.forEach(l => {
      const src = typeof l.source === 'object' ? (l.source as any).id : String(l.source)
      const tgt = typeof l.target === 'object' ? (l.target as any).id : String(l.target)
      const key = src < tgt ? `${src}--${tgt}` : `${tgt}--${src}`
      s.add(key)
    })
    return s
  }, [backbone])

  // Load data when method tab changes
  useEffect(() => {
    if (!activeMethod || !datasetId || !sessionId) return
    setLoading(true)

    const previewUrl = isCustomDataset ? datasetId : datasetId
    Promise.all([
      fetchDatasetPreview(datasetId, isCustomDataset),
      fetchBackbone(sessionId, activeMethod)
    ]).then(([orig, back]) => {
      setOriginal(orig)
      setBackbone(back)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [activeMethod, sessionId, datasetId, isCustomDataset])

  const m = METHODS.find(x => x.id === activeMethod)

  return (
    <StepCard stepNumber={6} title="Visual Comparison"
      subtitle="Explore the original graph alongside the extracted backbone. Use scroll to zoom, drag to pan.">

      {/* Controls bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        {/* Method tabs */}
        <div className="flex gap-2">
          {selectedMethods.map(id => {
            const mt = METHODS.find(x => x.id === id)
            return (
              <button key={id} onClick={() => setActiveMethod(id)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                style={activeMethod === id
                  ? { backgroundColor: mt?.color, color: 'white' }
                  : { backgroundColor: '#f3f4f6', color: '#374151' }}>
                {mt?.short}
              </button>
            )
          })}
        </div>

        {/* View mode toggle */}
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {(['side', 'overlay'] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                viewMode === mode ? 'bg-white shadow text-navy' : 'text-gray-500'
              }`}>
              {mode === 'side' ? '⬜⬜ Side by side' : '⬛ Overlay'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Loading graph data…
        </div>
      )}

      {!loading && original && backbone && (
        <>
          {/* Info strip */}
          <div className="flex gap-4 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-300 inline-block" />
              <span className="text-gray-500">
                Original: {original.nodes.length} nodes · {original.links.length} edges
                {original.sampled && ' (sampled)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: m?.color }} />
              <span className="text-gray-500">
                {m?.short} Backbone: {backbone.nodes.length} nodes · {backbone.links.length} edges
              </span>
            </div>
          </div>

          {viewMode === 'side' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Original Graph
                </div>
                  <GraphCanvas
                    data={original}
                    height={420}
                    downloadLabel="original-graph"
                  />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-2"
                  style={{ color: m?.color }}>
                  {m?.short} Backbone
                </div>
                <GraphCanvas
                    data={backbone}
                    accentColor={m?.color}
                    height={420}
                    showLabels={true}
                    downloadLabel={`backbone-${activeMethod}`}
                  />
              </div>
            </div>
          ) : (
            /* Overlay mode — render original with backbone edges highlighted */
            <div>
              <div className="text-xs text-gray-400 mb-2">
                <span className="inline-block w-6 border-b-2 border-gray-300 mr-1 align-middle" />
                Removed edges (grey)
                <span className="inline-block w-6 border-b-2 ml-4 mr-1 align-middle"
                  style={{ borderColor: m?.color }} />
                Backbone edges
              </div>
              <GraphCanvas
                  data={original}
                  backboneEdgeSet={backboneEdgeSet}
                  accentColor={m?.color}
                  height={500}
                  showLabels={false}
                  downloadLabel={`overlay-${activeMethod}`}
                />
            </div>
          )}

          {/* Legend */}
          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
            💡 Scroll to zoom · Drag nodes to reposition · Drag background to pan
          </div>
        </>
      )}

      <div className="flex justify-between pt-6">
        <Button variant="secondary" onClick={() => goToStep(5)}>← Back</Button>
        <Button onClick={() => goToStep(7)}>Next: Evaluate →</Button>
      </div>
    </StepCard>
  )
}
