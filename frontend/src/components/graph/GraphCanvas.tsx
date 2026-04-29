/**
 * components/graph/GraphCanvas.tsx
 * Interactive graph view using D3/SVG.
 *
 * Supports two Step-6 comparison modes on the same fixed layout:
 * - score-extremes: original edges black, lowest-score edges blue, highest-score edges red
 * - if-backbone: original edges black, Isolation Forest selected edges purple
 */
import React, { useEffect, useRef, useCallback } from 'react'
import * as d3 from 'd3'
import type { GraphData, GraphNode, GraphLink } from '../../types'

export type EdgeColorMode = 'default' | 'score-extremes' | 'if-backbone'

interface Props {
  data: GraphData
  /** IDs of edges to highlight as backbone. If undefined, all edges look the same. */
  backboneEdgeSet?: Set<string>
  /** Colour for backbone / highlighted edges */
  accentColor?: string
  height?: number
  /** Show node ID text inside each node circle */
  showLabels?: boolean
  downloadLabel?: string
  onNodeHover?: (node: GraphNode | null) => void
  /** Step-6 coloring mode */
  edgeColorMode?: EdgeColorMode
}

function edgeKey(s: string, t: string) {
  return s < t ? `${s}--${t}` : `${t}--${s}`
}

function stablePipeKey(s: string, t: string) {
  return s < t ? `${s}|${t}` : `${t}|${s}`
}

function hasFixedPositions(nodes: GraphNode[]) {
  return nodes.length > 0 && nodes.every((n) => Number.isFinite(Number(n.x)) && Number.isFinite(Number(n.y)))
}

function scaleFixedPositions(nodes: GraphNode[], width: number, height: number) {
  const xs = nodes.map((n) => Number(n.x))
  const ys = nodes.map((n) => Number(n.y))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  const padding = 44
  const usableW = Math.max(width - padding * 2, 1)
  const usableH = Math.max(height - padding * 2, 1)
  const scale = Math.min(usableW / spanX, usableH / spanY)

  return nodes.map((n) => ({
    ...n,
    x: padding + (Number(n.x) - minX) * scale + (usableW - spanX * scale) / 2,
    y: padding + (Number(n.y) - minY) * scale + (usableH - spanY * scale) / 2,
    fx: padding + (Number(n.x) - minX) * scale + (usableW - spanX * scale) / 2,
    fy: padding + (Number(n.y) - minY) * scale + (usableH - spanY * scale) / 2,
  }))
}

export function GraphCanvas({
  data,
  backboneEdgeSet,
  accentColor = '#0F6E56',
  height = 480,
  showLabels = false,
  onNodeHover,
  edgeColorMode = 'default',
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<any, any> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    if (!svgRef.current || !data?.nodes?.length) return
    const svg = d3.select(svgRef.current)
    const width = svgRef.current.clientWidth || 900

    svg.selectAll('*').remove()
    simRef.current?.stop()

    const root = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.04, 20])
        .on('zoom', (e) => root.attr('transform', e.transform))
    )

    const fixed = hasFixedPositions(data.nodes)
    const rawNodes: GraphNode[] = data.nodes.map((n) => ({ ...n }))
    const nodes: any[] = fixed ? scaleFixedPositions(rawNodes, width, height) : rawNodes
    const links: (GraphLink & d3.SimulationLinkDatum<GraphNode>)[] = data.links.map((l) => ({ ...l }))

    const nodeById = new Map(nodes.map((n) => [String(n.id), n]))
    if (fixed) {
      links.forEach((l: any) => {
        const src = typeof l.source === 'object' ? String((l.source as any).id) : String(l.source)
        const tgt = typeof l.target === 'object' ? String((l.target as any).id) : String(l.target)
        l.source = nodeById.get(src) ?? { id: src, x: 0, y: 0 }
        l.target = nodeById.get(tgt) ?? { id: tgt, x: 0, y: 0 }
      })
    }

    let sim: d3.Simulation<any, any> | null = null
    if (!fixed) {
      sim = d3
        .forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(50))
        .force('charge', d3.forceManyBody().strength(-80))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide(10))
      simRef.current = sim
    }

    const largeGraph = data.links.length > 2500 || data.nodes.length > 1200
    const maxW = d3.max(data.links, (l) => Number(l.weight) || 1) ?? 1
    const wScale = d3.scaleLinear([0, maxW], edgeColorMode === 'default' ? [0.8, 4] : (largeGraph ? [0.25, 1.15] : [0.45, 2.0]))

    const link = root
      .append('g')
      .attr('class', 'edges')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-linecap', 'round')
      .attr('stroke-width', (d) => {
        const isSpecial = d.score_region === 'low' || d.score_region === 'high' || d.is_if_backbone === true
        return isSpecial ? Math.max(largeGraph ? 0.55 : 1.05, wScale(Number(d.weight) || 1) + (largeGraph ? 0.25 : 0.7)) : wScale(Number(d.weight) || 1)
      })
      .each(function (d: any) {
        const s = typeof d.source === 'object' ? (d.source as any).id : d.source
        const t = typeof d.target === 'object' ? (d.target as any).id : d.target
        const keyDash = edgeKey(String(s), String(t))
        const keyPipe = stablePipeKey(String(s), String(t))
        const explicitKey = String(d.edge_key ?? '')

        let stroke = accentColor
        let opacity = 0.85
        let cssClass = 'edge'

        if (edgeColorMode === 'score-extremes') {
          if (d.score_region === 'low' || d.is_low_score === true) {
            stroke = '#2563EB'
            opacity = 1
            cssClass = 'edge score-low'
          } else if (d.score_region === 'high' || d.is_high_score === true) {
            stroke = '#DC2626'
            opacity = 1
            cssClass = 'edge score-high'
          } else {
            stroke = '#000000'
            opacity = 1
            cssClass = 'edge original'
          }
        } else if (edgeColorMode === 'if-backbone') {
          if (d.is_if_backbone === true) {
            stroke = '#7C3AED'
            opacity = 1
            cssClass = 'edge if-backbone'
          } else {
            stroke = '#000000'
            opacity = 1
            cssClass = 'edge original'
          }
        } else {
          const isBackbone = !backboneEdgeSet || backboneEdgeSet.has(keyDash) || backboneEdgeSet.has(keyPipe) || backboneEdgeSet.has(explicitKey)
          stroke = isBackbone ? accentColor : '#9CA3AF'
          opacity = isBackbone ? 0.85 : 0.30
          cssClass = isBackbone ? 'edge backbone' : 'edge removed'
        }

        d3.select(this)
          .attr('stroke', stroke)
          .attr('stroke-opacity', opacity)
          .attr('class', cssClass)
      })

    const maxDeg = d3.max(nodes, (n) => Number(n.degree) || 0) ?? 1
    const rScale = d3.scaleSqrt([0, maxDeg], [fixed ? (largeGraph ? 1.2 : 2.2) : 4, fixed ? (largeGraph ? 5.2 : 8.5) : 16])
    const colScale = d3.scaleSequential(d3.interpolateBlues).domain([-maxDeg * 0.5, maxDeg])

    const node = root
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .call(
        d3
          .drag<any, any>()
          .on('start', (e, d) => {
            if (sim && !e.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (e, d) => {
            d.fx = e.x; d.fy = e.y; d.x = e.x; d.y = e.y
            if (fixed) ticked()
          })
          .on('end', (e, d) => {
            if (sim && !e.active) sim.alphaTarget(0)
            if (!fixed) { d.fx = null; d.fy = null }
          })
      )

    node
      .append('circle')
      .attr('r', (d) => rScale(Number(d.degree) || 0))
      .attr('fill', (d) => colScale(Number(d.degree) || 0))
      .attr('fill-opacity', fixed ? (largeGraph ? 0.68 : 0.82) : 1)
      .attr('stroke', '#1E3A8A')
      .attr('stroke-width', (d) => largeGraph ? 0.25 : (rScale(Number(d.degree) || 0) > 7 ? 1.2 : 0.55))

    if (showLabels) {
      node
        .append('text')
        .text((d) => String(d.id))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', (d) => Math.max(6, Math.min(rScale(Number(d.degree) || 0) * 0.82, 10)) + 'px')
        .attr('font-weight', '700')
        .attr('fill', (d) => (rScale(Number(d.degree) || 0) >= 7.5 ? '#ffffff' : '#0f172a'))
        .attr('stroke', (d) => (rScale(Number(d.degree) || 0) >= 7.5 ? '#1E3A8A' : '#ffffff'))
        .attr('stroke-width', 0.8)
        .style('paint-order', 'stroke')
        .attr('pointer-events', 'none')
        .style('user-select', 'none')
    }

    node
      .on('mouseenter', (evt, d) => {
        onNodeHover?.(d)
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'block'
          tooltipRef.current.innerHTML = `<b>${d.id}</b><br/>degree: ${d.degree}`
        }
      })
      .on('mousemove', (evt) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = evt.offsetX + 14 + 'px'
          tooltipRef.current.style.top = evt.offsetY - 10 + 'px'
        }
      })
      .on('mouseleave', () => {
        onNodeHover?.(null)
        if (tooltipRef.current) tooltipRef.current.style.display = 'none'
      })

    function ticked() {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    }

    if (fixed) {
      ticked()
    } else if (sim) {
      sim.on('tick', ticked)
    }
  }, [data, backboneEdgeSet, accentColor, height, showLabels, onNodeHover, edgeColorMode])

  useEffect(() => {
    draw()
    return () => { simRef.current?.stop() }
  }, [draw])

  return (
    <div className="relative w-full" style={{ height }}>
      <div className="w-full bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height }}>
        <svg
          ref={svgRef}
          className="graph-canvas"
          width="100%"
          height={height}
          style={{ background: '#F8FAFC' }}
        />
        <div ref={tooltipRef} className="graph-tooltip" style={{ display: 'none' }} />
      </div>
    </div>
  )
}
