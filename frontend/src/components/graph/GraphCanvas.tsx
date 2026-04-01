/**
 * components/graph/GraphCanvas.tsx
 * Interactive force-directed graph using D3.
 * Handles zoom/pan, node drag, tooltips, backbone highlighting,
 * optional node-ID labels, and SVG/PNG download.
 */
import React, { useEffect, useRef, useCallback } from 'react'
import * as d3 from 'd3'
import type { GraphData, GraphNode, GraphLink } from '../../types'
import { downloadSvgElement, downloadPngElement } from '../../utils/svgExport'

interface Props {
  data: GraphData
  /** IDs of edges to highlight as backbone. If undefined, all edges look the same. */
  backboneEdgeSet?: Set<string>
  /** Colour for backbone / highlighted edges */
  accentColor?: string
  height?: number
  /** Show node ID text inside each node circle */
  showLabels?: boolean
  /** If provided, a download button labelled with this string appears */
  downloadLabel?: string
  onNodeHover?: (node: GraphNode | null) => void
}

function edgeKey(s: string, t: string) {
  return s < t ? `${s}--${t}` : `${t}--${s}`
}




export function GraphCanvas({
  data,
  backboneEdgeSet,
  accentColor = '#0F6E56',
  height = 480,
  showLabels = false,
  downloadLabel,
  onNodeHover,
}: Props) {
  const svgRef     = useRef<SVGSVGElement>(null)
  const simRef     = useRef<d3.Simulation<any, any> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    if (!svgRef.current || !data?.nodes?.length) return
    const svg   = d3.select(svgRef.current)
    const width = svgRef.current.clientWidth || 800

    svg.selectAll('*').remove()

    // ── Zoom + Pan ────────────────────────────────────────────────
    const root = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 10])
        .on('zoom', (e) => root.attr('transform', e.transform))
    )

    const nodes: GraphNode[] = data.nodes.map((n) => ({ ...n }))
    const links: (GraphLink & d3.SimulationLinkDatum<GraphNode>)[] =
      data.links.map((l) => ({ ...l }))

    // ── Simulation ────────────────────────────────────────────────
    const sim = d3
      .forceSimulation(nodes)
      .force('link',    d3.forceLink(links).id((d: any) => d.id).distance(50))
      .force('charge',  d3.forceManyBody().strength(-80))
      .force('center',  d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(10))
    simRef.current = sim

    // ── Edges ─────────────────────────────────────────────────────
    const maxW   = d3.max(data.links, (l) => l.weight) ?? 1
    const wScale = d3.scaleLinear([0, maxW], [0.8, 4])

    const link = root
      .append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width', (d) => wScale(d.weight))
      .each(function (d) {
        const s   = typeof d.source === 'object' ? (d.source as any).id : d.source
        const t   = typeof d.target === 'object' ? (d.target as any).id : d.target
        const key = edgeKey(String(s), String(t))
        const isBackbone = !backboneEdgeSet || backboneEdgeSet.has(key)
        d3.select(this)
          .attr('stroke',         isBackbone ? accentColor : '#9CA3AF')
          .attr('stroke-opacity', isBackbone ? 0.85 : 0.30)
          .classed('backbone', isBackbone)
          .classed('removed',  !isBackbone)
      })

    // ── Nodes ─────────────────────────────────────────────────────
    const maxDeg = d3.max(nodes, (n) => n.degree) ?? 1

    // Scale radius: min 4px, max 16px
    const rScale = d3.scaleSqrt([0, maxDeg], [4, 16])

    // Color: shift domain start negative so even low-degree nodes get a mid-blue
    // instead of near-white. Result: all nodes clearly visible.
    const colScale = d3
      .scaleSequential(d3.interpolateBlues)
      .domain([-maxDeg * 0.5, maxDeg])

    const node = root
      .append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .call(
        d3
          .drag<any, any>()
          .on('start', (e, d) => {
            if (!e.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end',   (e, d) => {
            if (!e.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    // Circle
    node
      .append('circle')
      .attr('r',            (d) => rScale(d.degree))
      .attr('fill',         (d) => colScale(d.degree))
      .attr('stroke',       '#1E3A8A')
      .attr('stroke-width', (d) => (rScale(d.degree) > 7 ? 1.5 : 0.8))

    // Node label: show the node ID inside the circle when showLabels is true
    // and the circle is big enough (r > 8). On smaller nodes show on hover only.
    if (showLabels) {
      node
        .append('text')
        .text((d) => {
          const r = rScale(d.degree)
          // Only embed text if the circle fits at least 2 chars
          return r >= 8 ? String(d.id) : ''
        })
        .attr('text-anchor',       'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size',         (d) => Math.min(rScale(d.degree) * 0.85, 11) + 'px')
        .attr('font-weight',       '600')
        .attr('fill',              '#ffffff')
        .attr('pointer-events',    'none')
        .style('user-select',      'none')
    }

    // Tooltip
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
          tooltipRef.current.style.top  = evt.offsetY - 10 + 'px'
        }
      })
      .on('mouseleave', () => {
        onNodeHover?.(null)
        if (tooltipRef.current) tooltipRef.current.style.display = 'none'
      })

    // ── Tick ─────────────────────────────────────────────────────
    sim.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as any).x)
        .attr('y1', (d) => (d.source as any).y)
        .attr('x2', (d) => (d.target as any).x)
        .attr('y2', (d) => (d.target as any).y)
      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })
  }, [data, backboneEdgeSet, accentColor, height, showLabels, onNodeHover])

  useEffect(() => {
    draw()
    return () => { simRef.current?.stop() }
  }, [draw])

  return (
    <div className="relative w-full" style={{ height }}>
      {/* Canvas */}
      <div
        className="w-full bg-white rounded-xl border border-gray-200 overflow-hidden"
        style={{ height }}
      >
        <svg
          ref={svgRef}
          className="graph-canvas"
          width="100%"
          height={height}
          style={{ background: '#F8FAFC' }}
        />
        <div ref={tooltipRef} className="graph-tooltip" style={{ display: 'none' }} />
      </div>

      {/* Download controls — only rendered when downloadLabel is provided */}
      {downloadLabel && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={() =>
              svgRef.current &&
              downloadSvgElement(svgRef.current, `${downloadLabel}.svg`)
            }
            className="px-2 py-1 text-xs bg-white border border-gray-200 rounded shadow-sm
                      hover:bg-gray-50 text-gray-600 font-medium"
            title="Download SVG"
          >
            ⬇ SVG
          </button>

          <button
            onClick={() =>
              svgRef.current &&
              void downloadPngElement(svgRef.current, `${downloadLabel}.png`, { scale: 4 })
            }
            className="px-2 py-1 text-xs bg-white border border-gray-200 rounded shadow-sm
                      hover:bg-gray-50 text-gray-600 font-medium"
            title="Download high-resolution PNG"
          >
            ⬇ PNG 4x
          </button>
        </div>
      )}
    </div>
  )
}