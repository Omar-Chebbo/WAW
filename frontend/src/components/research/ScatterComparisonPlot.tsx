import React, { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist'
import type { Scatter3DData } from '../../types'

interface Props {
  data: Scatter3DData
}

export default function ScatterComparisonPlot({ data }: Props) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const [exportingLeft, setExportingLeft] = useState<string | null>(null)
  const [exportingRight, setExportingRight] = useState<string | null>(null)

  const backbone = data.points.filter(p => p.is_backbone)
  const nonBackbone = data.points.filter(p => !p.is_backbone)
  const rho = data.backbone_contamination ?? 0.20
  const yAnomalyScores = data.points.map((p) => p.z).filter((v) => Number.isFinite(v))
  const sortedY = [...yAnomalyScores].sort((a, b) => a - b)
  const cutoffIndex = Math.max(0, Math.ceil(rho * Math.max(sortedY.length, 1)) - 1)
  const paLpCutoff = sortedY.length > 0 ? sortedY[Math.min(cutoffIndex, sortedY.length - 1)] : null

  useEffect(() => {
    if (data.points.length === 0) return

    type AxisKey = 'x' | 'y' | 'z'

    const plotConfigs = [
      { ref: leftRef, xKey: 'x' as AxisKey, yKey: 'z' as AxisKey, xLabel: 'PA Anomaly Score', yLabel: 'PA+LP Anomaly Score' },
      { ref: rightRef, xKey: 'y' as AxisKey, yKey: 'z' as AxisKey, xLabel: 'LP Anomaly Score', yLabel: 'PA+LP Anomaly Score' },
    ]

    plotConfigs.forEach(({ ref, xKey, yKey, xLabel, yLabel }) => {
      if (!ref.current) return

      const traces: Plotly.Data[] = [
        {
          x: nonBackbone.map(p => p[xKey]),
          y: nonBackbone.map(p => p[yKey]),
          mode: 'markers',
          type: 'scatter',
          name: 'Non-backbone',
          marker: { size: 2.5, color: '#B0BEC5', opacity: 0.7, line: { width: 0 } },
          hovertemplate:
            '<b>Non-backbone</b><br>' +
            'Edge: %{customdata}<br>' +
            xLabel + ': %{x:.4f}<br>' +
            yLabel + ': %{y:.4f}<br>' +
            '<extra></extra>',
          customdata: nonBackbone.map(p => `${p.source} \u2014 ${p.target}`),
        },
        {
          x: backbone.map(p => p[xKey]),
          y: backbone.map(p => p[yKey]),
          mode: 'markers',
          type: 'scatter',
          name: `Backbone (PA+LP, ${Math.round(rho * 100)}%)`,
          marker: { size: 3.5, color: '#0F766E', opacity: 1, line: { width: 0 } },
          hovertemplate:
            '<b>Backbone</b><br>' +
            'Edge: %{customdata[0]}<br>' +
            xLabel + ': %{x:.4f}<br>' +
            yLabel + ': %{y:.4f}<br>' +
            'PA rank: %{customdata[1]}<br>' +
            'LP rank: %{customdata[2]}<br>' +
            'PA+LP rank: %{customdata[3]}<br>' +
            '<extra></extra>',
          customdata: backbone.map(p => [`${p.source} \u2014 ${p.target}`, p.pa_rank, p.lp_rank, p.pa_lp_rank]),
        },
      ]

      const layout: Partial<Plotly.Layout> = {
        xaxis: {
          title: {
            text: `${xLabel}<br><span style="font-size:10px;color:#64748B">\u2190 More anomalous (more negative)</span>`,
            font: { size: 13 },
          },
          gridcolor: '#E2E8F0',
          zerolinecolor: '#94A3B8',
          showline: true,
          linewidth: 1,
          linecolor: '#CBD5E1',
          tickfont: { size: 11 },
        },
        yaxis: {
          title: {
            text: `${yLabel}<br><span style="font-size:10px;color:#64748B">\u2193 More anomalous (more negative)</span>`,
            font: { size: 13 },
          },
          gridcolor: '#E2E8F0',
          zerolinecolor: '#94A3B8',
          showline: true,
          linewidth: 1,
          linecolor: '#CBD5E1',
          tickfont: { size: 11 },
        },
        paper_bgcolor: 'white',
        plot_bgcolor: '#FAFBFC',
        font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#334155' },
        margin: { l: 70, r: 30, t: 15, b: 65 },
        legend: {
          x: 1.01,
          y: 1,
          bgcolor: 'rgba(255,255,255,0.95)',
          bordercolor: '#E2E8F0',
          borderwidth: 1,
          font: { size: 10 },
        },
        hoverlabel: {
          bgcolor: 'white',
          bordercolor: '#E2E8F0',
          font: { size: 10, color: '#334155' },
        },
        shapes: paLpCutoff === null ? [] : [
          {
            type: 'line',
            xref: 'paper',
            x0: 0,
            x1: 1,
            yref: 'y',
            y0: paLpCutoff,
            y1: paLpCutoff,
            line: { color: '#374151', width: 1.5, dash: 'dash' },
          },
        ],
        annotations: paLpCutoff === null ? [] : [
          {
            xref: 'paper',
            x: 0.99,
            yref: 'y',
            y: paLpCutoff,
            text: `ρ = ${rho.toFixed(2)}`,
            showarrow: false,
            xanchor: 'right',
            yanchor: 'bottom',
            font: { size: 10, color: '#475569' },
            bgcolor: 'rgba(255,255,255,0.85)',
          },
        ],
      }

      const config: Partial<Plotly.Config> = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
        displaylogo: false,
        scrollZoom: true,
      }

      Plotly.newPlot(ref.current, traces, layout, config)
    })

    return () => {
      if (leftRef.current) Plotly.purge(leftRef.current)
      if (rightRef.current) Plotly.purge(rightRef.current)
    }
  }, [data])

  async function exportLeftPlot(format: 'png' | 'svg' | 'pdf') {
    setExportingLeft(format)
    try {
      const rows: Array<{ x: number; y: number }> = []
      nonBackbone.forEach((p) => rows.push({ x: p.x, y: p.z }))
      backbone.forEach((p) => rows.push({ x: p.x, y: p.z }))

      const res = await fetch('/api/exports/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figure_type: 'paper_score_scatter',
          format,
          title: 'PA vs PA+LP Anomaly Score',
          filename: 'pa-vs-palp-anomaly-paper',
          payload: {
            method: 'pa',
            rho,
            anomaly_direction: 'low',
            rows,
            x_key: 'x',
            y_key: 'y',
            x_label: 'PA Anomaly Score',
            y_label: 'PA+LP Anomaly Score',
          },
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'pa-vs-palp-anomaly-paper.' + format
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch (err: any) {
      console.error('Export failed:', err)
      alert('Export failed: ' + err.message)
    } finally {
      setExportingLeft(null)
    }
  }

  async function exportRightPlot(format: 'png' | 'svg' | 'pdf') {
    setExportingRight(format)
    try {
      const rows: Array<{ x: number; y: number }> = []
      nonBackbone.forEach((p) => rows.push({ x: p.y, y: p.z }))
      backbone.forEach((p) => rows.push({ x: p.y, y: p.z }))

      const res = await fetch('/api/exports/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figure_type: 'paper_score_scatter',
          format,
          title: 'LP vs PA+LP Anomaly Score',
          filename: 'lp-vs-palp-anomaly-paper',
          payload: {
            method: 'lp',
            rho,
            anomaly_direction: 'low',
            rows,
            x_key: 'x',
            y_key: 'y',
            x_label: 'LP Anomaly Score',
            y_label: 'PA+LP Anomaly Score',
          },
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'lp-vs-palp-anomaly-paper.' + format
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch (err: any) {
      console.error('Export failed:', err)
      alert('Export failed: ' + err.message)
    } finally {
      setExportingRight(null)
    }
  }


  function ExportButtons({ side }: { side: 'left' | 'right' }) {
    const exporting = side === 'left' ? exportingLeft : exportingRight
    const doExport = side === 'left' ? exportLeftPlot : exportRightPlot
    return (
      <div className="flex items-center gap-2">
        {(['png', 'svg', 'pdf'] as const).map((fmt) => (
          <button
            key={fmt}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-sm disabled:opacity-50"
            disabled={exporting === fmt}
            onClick={() => doExport(fmt)}
            title={fmt === 'png' ? 'Download PNG' : fmt === 'svg' ? 'Download SVG' : 'Download PDF'}
          >
            {exporting === fmt ? 'Exporting…' : fmt === 'png' ? 'PNG' : fmt.toUpperCase()}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-bold text-navy">Individual vs Multi-Feature Anomaly Comparison</div>
          <div className="text-sm text-gray-500 mt-1 max-w-3xl">
            Each point is an edge. Left plot: PA anomaly score vs PA+LP multi-feature score.
            Right plot: LP anomaly score vs PA+LP multi-feature score.
            Points colored by PA+LP backbone membership at {Math.round(data.backbone_contamination * 100)}% contamination. The dashed horizontal line shows the PA+LP cutoff used to retain the most anomalous {Math.round(rho * 100)}% of edges. More negative Isolation Forest scores indicate stronger anomalies, so the anomaly region is below the cutoff line. Use the visible PNG / SVG / PDF buttons on each panel to download manuscript-style exports of these figures.
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-semibold text-teal-700">{data.backbone_count.toLocaleString()} backbone</div>
          <div className="text-xs text-gray-500">{data.non_backbone_count.toLocaleString()} non-backbone</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Left plot: PA vs PA+LP */}
        <div className="bg-slate-50 rounded-2xl border border-gray-100 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-navy">PA vs PA+LP Anomaly Score</div>
              <div className="text-[11px] text-gray-500 mt-1">Download the clean manuscript-style version here, including the dashed cutoff line.</div>
            </div>
            <ExportButtons side="left" />
          </div>
          <div ref={leftRef} style={{ width: '100%', height: '650px' }} />
        </div>

        {/* Right plot: LP vs PA+LP */}
        <div className="bg-slate-50 rounded-2xl border border-gray-100 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-navy">LP vs PA+LP Anomaly Score</div>
              <div className="text-[11px] text-gray-500 mt-1">Download the clean manuscript-style version here, including the dashed cutoff line.</div>
            </div>
            <ExportButtons side="right" />
          </div>
          <div ref={rightRef} style={{ width: '100%', height: '650px' }} />
        </div>
      </div>
    </div>
  )
}
