import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData } from '../../types'

type EdgeState = 'kept' | 'added' | 'removed' | 'context'

interface Props {
  originalGraph: GraphData
  baselineLabel: string
  baselineEdgeKeys: string[]
  selectedRunLabel: string
  selectedEdgeKeys: string[]
  accentColor?: string
}

const EDGE_STATE_LABELS: Record<EdgeState, string> = {
  kept: 'Kept in both',
  added: 'Added in selected run',
  removed: 'Present in baseline only',
  context: 'Outside both selections',
}

const EDGE_STATE_COLORS: Record<EdgeState, string> = {
  kept: '#0F766E',
  added: '#2563EB',
  removed: '#BA7517',
  context: '#D1D5DB',
}

async function loadSigmaModules() {
  const graphologyUrl = 'https://esm.sh/graphology@0.26.0?bundle'
  const sigmaUrl = 'https://esm.sh/sigma@3.0.2?bundle'

  const [graphologyModule, sigmaModule] = await Promise.all([
    import(/* @vite-ignore */ graphologyUrl),
    import(/* @vite-ignore */ sigmaUrl),
  ])

  return {
    Graph: graphologyModule.default,
    Sigma: (sigmaModule as any).default ?? (sigmaModule as any).Sigma ?? sigmaModule,
  }
}

function stableEdgeKey(source: string, target: string) {
  return source < target ? `${source}|${target}` : `${target}|${source}`
}

function toNodeId(value: GraphData['links'][number]['source']) {
  return typeof value === 'string' ? value : String(value.id)
}

function sizeForDegree(degree: number, maxDegree: number) {
  if (maxDegree <= 0) return 4
  const ratio = Math.sqrt(Math.max(degree, 1) / maxDegree)
  return 3 + ratio * 7
}

function circularPosition(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1)
  return {
    x: Math.cos(angle) * 10,
    y: Math.sin(angle) * 10,
  }
}

export default function ContaminationGraphDiffPanel({
  originalGraph,
  baselineLabel,
  baselineEdgeKeys,
  selectedRunLabel,
  selectedEdgeKeys,
  accentColor = '#0F6E56',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<any>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showContextEdges, setShowContextEdges] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const originalEdgeKeys = useMemo(
    () =>
      originalGraph.links.map((link) => {
        const source = toNodeId(link.source)
        const target = toNodeId(link.target)
        return String(link.edge_key ?? stableEdgeKey(source, target))
      }),
    [originalGraph]
  )

  const diff = useMemo(() => {
    const originalSet = new Set(originalEdgeKeys)
    const baselineSet = new Set(baselineEdgeKeys)
    const selectedSet = new Set(selectedEdgeKeys)

    const nodeMembership = new Map<string, { selected: boolean; baseline: boolean }>()
    const stateByEdgeKey = new Map<string, EdgeState>()
    let kept = 0
    let added = 0
    let removed = 0
    let context = 0

    originalGraph.links.forEach((link) => {
      const source = toNodeId(link.source)
      const target = toNodeId(link.target)
      const edgeKey = String(link.edge_key ?? stableEdgeKey(source, target))
      const inBaseline = baselineSet.has(edgeKey)
      const inSelected = selectedSet.has(edgeKey)

      let state: EdgeState = 'context'
      if (inBaseline && inSelected) {
        state = 'kept'
        kept += 1
      } else if (!inBaseline && inSelected) {
        state = 'added'
        added += 1
      } else if (inBaseline && !inSelected) {
        state = 'removed'
        removed += 1
      } else {
        context += 1
      }

      stateByEdgeKey.set(edgeKey, state)

      if (inBaseline || inSelected) {
        const sourceMembership = nodeMembership.get(source) ?? { selected: false, baseline: false }
        sourceMembership.selected = sourceMembership.selected || inSelected
        sourceMembership.baseline = sourceMembership.baseline || inBaseline
        nodeMembership.set(source, sourceMembership)

        const targetMembership = nodeMembership.get(target) ?? { selected: false, baseline: false }
        targetMembership.selected = targetMembership.selected || inSelected
        targetMembership.baseline = targetMembership.baseline || inBaseline
        nodeMembership.set(target, targetMembership)
      }
    })

    let selectedOutsideOriginal = 0
    selectedSet.forEach((edgeKey) => {
      if (!originalSet.has(edgeKey)) selectedOutsideOriginal += 1
    })

    const union = new Set([...baselineSet, ...selectedSet])
    const jaccard = union.size === 0 ? 1 : kept / union.size

    return {
      stateByEdgeKey,
      nodeMembership,
      counts: { kept, added, removed, context, original: originalSet.size, selectedOutsideOriginal },
      jaccard,
    }
  }, [baselineEdgeKeys, originalEdgeKeys, originalGraph, selectedEdgeKeys])

  const clickedNodeDetails = useMemo(() => {
    if (!selectedNodeId) return null
    const node = originalGraph.nodes.find((item) => String(item.id) === selectedNodeId)
    const membership = diff.nodeMembership.get(selectedNodeId)
    return {
      id: selectedNodeId,
      degree: node?.degree ?? 0,
      inSelected: membership?.selected ?? false,
      inBaseline: membership?.baseline ?? false,
    }
  }, [diff.nodeMembership, originalGraph.nodes, selectedNodeId])

  useEffect(() => {
    let cancelled = false

    async function renderSigma() {
      if (!containerRef.current) return
      setLoadError(null)

      sigmaRef.current?.kill?.()
      containerRef.current.innerHTML = ''

      try {
        const { Graph, Sigma } = await loadSigmaModules()
        if (cancelled || !containerRef.current) return

        const graph = new Graph()
        const maxDegree = Math.max(...originalGraph.nodes.map((node) => Number(node.degree) || 0), 1)

        originalGraph.nodes.forEach((node, index) => {
          const nodeId = String(node.id)
          const position = node.x != null && node.y != null ? { x: node.x, y: node.y } : circularPosition(index, originalGraph.nodes.length)
          const membership = diff.nodeMembership.get(nodeId)
          const nodeColor = membership?.selected
            ? accentColor
            : membership?.baseline
            ? '#BA7517'
            : '#94A3B8'

          graph.addNode(nodeId, {
            ...position,
            size: sizeForDegree(Number(node.degree) || 0, maxDegree),
            color: nodeColor,
            label: nodeId,
          })
        })

        originalGraph.links.forEach((link, index) => {
          const source = toNodeId(link.source)
          const target = toNodeId(link.target)
          const edgeKey = String(link.edge_key ?? stableEdgeKey(source, target))
          const state = diff.stateByEdgeKey.get(edgeKey) ?? 'context'

          graph.addEdgeWithKey(edgeKey || `edge-${index}`, source, target, {
            size: state === 'context' ? 0.7 : state === 'kept' ? 2.2 : 1.8,
            color: EDGE_STATE_COLORS[state],
            hidden: !showContextEdges && state === 'context',
            zIndex: state === 'context' ? 0 : 1,
          })
        })

        const sigma = new Sigma(graph, containerRef.current, {
          renderEdgeLabels: false,
          renderLabels: false,
          labelDensity: 0.08,
          labelGridCellSize: 120,
          zIndex: true,
        })

        sigma.on?.('clickNode', (event: any) => {
          setSelectedNodeId(String(event.node))
        })

        sigma.on?.('clickStage', () => {
          setSelectedNodeId(null)
        })

        sigmaRef.current = sigma
        sigma.getCamera?.().animatedReset?.()
      } catch (error: any) {
        if (!cancelled) {
          console.error(error)
          setLoadError('Sigma.js could not be loaded in this environment. The structural diff panel needs access to the Sigma/Graphology modules.')
        }
      }
    }

    void renderSigma()

    return () => {
      cancelled = true
      sigmaRef.current?.kill?.()
      sigmaRef.current = null
    }
  }, [accentColor, diff.nodeMembership, diff.stateByEdgeKey, originalGraph, showContextEdges])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-navy">Sigma structural diff viewer</div>
          <div className="text-xs text-gray-500 mt-1 leading-5 max-w-3xl">
            This viewer compares <strong>{selectedRunLabel}</strong> against <strong>{baselineLabel}</strong>. Use it to see whether contamination mostly grows the backbone or changes its identity.
          </div>
        </div>

        <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 bg-white">
          <input
            type="checkbox"
            checked={showContextEdges}
            onChange={(event) => setShowContextEdges(event.target.checked)}
            className="accent-teal"
          />
          Show context edges
        </label>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr),280px] gap-5">
        <div className="rounded-2xl border border-gray-100 bg-slate-50 overflow-hidden">
          {loadError ? (
            <div className="h-[560px] flex items-center justify-center p-6 text-sm text-gray-500 text-center leading-6">
              {loadError}
            </div>
          ) : (
            <div ref={containerRef} className="h-[560px] w-full" />
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Legend</div>
            <div className="space-y-2 text-sm text-gray-600">
              {(['kept', 'added', 'removed', 'context'] as EdgeState[]).map((state) => (
                <div key={state} className="flex items-center gap-3">
                  <span className="inline-block h-3 w-6 rounded-full" style={{ backgroundColor: EDGE_STATE_COLORS[state] }} />
                  <span>{EDGE_STATE_LABELS[state]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Comparison stats</div>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex items-center justify-between gap-3"><span>Baseline edges</span><strong>{baselineEdgeKeys.length}</strong></div>
              <div className="flex items-center justify-between gap-3"><span>Selected edges</span><strong>{selectedEdgeKeys.length}</strong></div>
              <div className="flex items-center justify-between gap-3"><span>Kept in both</span><strong>{diff.counts.kept}</strong></div>
              <div className="flex items-center justify-between gap-3"><span>Added in selected</span><strong>{diff.counts.added}</strong></div>
              <div className="flex items-center justify-between gap-3"><span>Removed from baseline</span><strong>{diff.counts.removed}</strong></div>
              <div className="flex items-center justify-between gap-3"><span>Original graph edges</span><strong>{diff.counts.original}</strong></div>
              <div className="flex items-center justify-between gap-3"><span>Jaccard</span><strong>{diff.jaccard.toFixed(4)}</strong></div>
              {diff.counts.selectedOutsideOriginal > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-5 mt-3">
                  {diff.counts.selectedOutsideOriginal} selected edge keys were not found in the original graph snapshot.
                </div>
              ) : null}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Node focus</div>
            {clickedNodeDetails ? (
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex items-center justify-between gap-3"><span>Node</span><strong>{clickedNodeDetails.id}</strong></div>
                <div className="flex items-center justify-between gap-3"><span>Original degree</span><strong>{clickedNodeDetails.degree}</strong></div>
                <div className="flex items-center justify-between gap-3"><span>In selected run</span><strong>{clickedNodeDetails.inSelected ? 'Yes' : 'No'}</strong></div>
                <div className="flex items-center justify-between gap-3"><span>In baseline</span><strong>{clickedNodeDetails.inBaseline ? 'Yes' : 'No'}</strong></div>
              </div>
            ) : (
              <div className="text-sm text-gray-500 leading-6">
                Click a node in the Sigma view to inspect whether it participates in the selected backbone and in the baseline/original graph reference.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
