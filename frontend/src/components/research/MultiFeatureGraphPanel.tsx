import React, { useMemo } from 'react'
import type { GraphData } from '../../types'

interface Props {
  title: string
  graph: GraphData
  selectedEdgeKeys?: string[]
  accentColor?: string
  showOriginal?: boolean
}

function stableEdgeKey(source: string, target: string) {
  return source < target ? `${source}|${target}` : `${target}|${source}`
}

function toNodeId(value: GraphData['links'][number]['source']) {
  return typeof value === 'string' ? value : String(value.id)
}

export default function MultiFeatureGraphPanel({
  title,
  graph,
  selectedEdgeKeys = [],
  accentColor = '#0F766E',
  showOriginal = false,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedEdgeKeys), [selectedEdgeKeys])

  const allLinks = graph.links

  const selectedLinks = useMemo(() => {
    if (showOriginal) return graph.links
    return graph.links.filter((link) => {
      const source = toNodeId(link.source)
      const target = toNodeId(link.target)
      const edgeKey = String(link.edge_key ?? stableEdgeKey(source, target))
      return selectedSet.has(edgeKey)
    })
  }, [graph.links, selectedSet, showOriginal])

  const selectedNodeIds = useMemo(() => {
    if (showOriginal) return new Set(graph.nodes.map((node) => String(node.id)))
    const ids = new Set<string>()
    selectedLinks.forEach((link) => {
      ids.add(toNodeId(link.source))
      ids.add(toNodeId(link.target))
    })
    return ids
  }, [graph.nodes, showOriginal, selectedLinks])

  const layout = useMemo(() => {
    const width = 420
    const height = 320
    const padding = 24
    if (graph.nodes.length === 0) {
      return {
        width,
        height,
        positions: new Map<string, { x: number; y: number }>(),
      }
    }

    const xs = graph.nodes.map((node) => Number(node.x ?? 0))
    const ys = graph.nodes.map((node) => Number(node.y ?? 0))
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const spanX = maxX - minX || 1
    const spanY = maxY - minY || 1

    const positions = new Map<string, { x: number; y: number }>()
    graph.nodes.forEach((node) => {
      const x = ((Number(node.x ?? 0) - minX) / spanX) * (width - padding * 2) + padding
      const y = ((Number(node.y ?? 0) - minY) / spanY) * (height - padding * 2) + padding
      positions.set(String(node.id), { x, y: height - y })
    })

    return { width, height, positions }
  }, [graph.nodes])

  const maxDegree = useMemo(() => Math.max(...graph.nodes.map((node) => Number(node.degree) || 0), 1), [graph.nodes])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-navy">{title}</div>
          <div className="text-xs text-gray-500 mt-1">
            {showOriginal ? `${graph.nodes.length} nodes · ${graph.links.length} edges` : `${selectedNodeIds.size} nodes · ${selectedLinks.length} edges`}
          </div>
        </div>
        {!showOriginal ? (
          <div className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-600">
            Gray = original context · Color = kept backbone
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-gray-100 bg-slate-50 overflow-hidden">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-[320px]">
          {!showOriginal && allLinks.map((link, index) => {
            const source = toNodeId(link.source)
            const target = toNodeId(link.target)
            const sourcePos = layout.positions.get(source)
            const targetPos = layout.positions.get(target)
            if (!sourcePos || !targetPos) return null
            return (
              <line
                key={`context-${index}`}
                x1={sourcePos.x}
                y1={sourcePos.y}
                x2={targetPos.x}
                y2={targetPos.y}
                stroke="#D7DEE8"
                strokeOpacity={0.42}
                strokeWidth={0.9}
              />
            )
          })}

          {selectedLinks.map((link, index) => {
            const source = toNodeId(link.source)
            const target = toNodeId(link.target)
            const edgeKey = String(link.edge_key ?? stableEdgeKey(source, target))
            const sourcePos = layout.positions.get(source)
            const targetPos = layout.positions.get(target)
            if (!sourcePos || !targetPos) return null
            return (
              <line
                key={`${edgeKey}-${index}`}
                x1={sourcePos.x}
                y1={sourcePos.y}
                x2={targetPos.x}
                y2={targetPos.y}
                stroke={showOriginal ? '#2563EB' : accentColor}
                strokeOpacity={showOriginal ? 0.78 : 0.88}
                strokeWidth={showOriginal ? 1.5 : 2.3}
              />
            )
          })}

          {!showOriginal && graph.nodes.map((node) => {
            const pos = layout.positions.get(String(node.id))
            if (!pos) return null
            const radius = 2.6 + (Math.sqrt((Number(node.degree) || 1) / maxDegree) * 4.2)
            return (
              <circle
                key={`context-node-${String(node.id)}`}
                cx={pos.x}
                cy={pos.y}
                r={radius}
                fill="#E5EAF2"
                stroke="#CBD5E1"
                strokeWidth={0.8}
              />
            )
          })}

          {(showOriginal ? graph.nodes : graph.nodes.filter((node) => selectedNodeIds.has(String(node.id)))).map((node) => {
            const pos = layout.positions.get(String(node.id))
            if (!pos) return null
            const radius = 3 + (Math.sqrt((Number(node.degree) || 1) / maxDegree) * 5.5)
            const fill = showOriginal ? '#2563EB' : accentColor
            return (
              <g key={String(node.id)} transform={`translate(${pos.x},${pos.y})`}>
                <circle r={radius} fill={fill} fillOpacity={0.92} stroke="#ffffff" strokeWidth={1.1} />
                {radius >= 6.2 ? (
                  <text textAnchor="middle" dy="0.35em" fontSize="8" fill="#fff" fontWeight={700}>
                    {String(node.id)}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
