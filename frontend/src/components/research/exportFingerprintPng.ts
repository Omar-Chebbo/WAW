import type { MultiFeatureScoreProfile, RegionConfig } from '../../types'

/**
 * Export a minimal publication-style 3×3 heatmap from the experiment fingerprint.
 * Style B: short title only, no metadata block, no explanatory footer, no colorbar.
 * Cell color = selection rate within the region (selected / total).
 */
export function exportFingerprintPng({
  profile, regionConfig, datasetLabel: _datasetLabel, retention: _retention,
}: {
  profile: MultiFeatureScoreProfile
  regionConfig?: RegionConfig
  datasetLabel: string
  retention: number
}): void {
  const W = 1150
  const H = 820
  const scale = 3
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported by this browser.')
  ctx.scale(scale, scale)

  const ink = '#1a2533'
  const muted = '#536273'
  const regions = ['high', 'middle', 'low'] as const
  const percent = (fraction: number) => `${Number((fraction * 100).toFixed(1))}%`
  const axisLabel = (prefix: 'PA' | 'LP', region: string) => region === 'high'
    ? { main: `${prefix} High`, sub: `(${percent(regionConfig?.high_pct ?? 0.1)})` }
    : region === 'low'
      ? { main: `${prefix} Low`, sub: `(${percent(regionConfig?.low_pct ?? 0.1)})` }
      : { main: `${prefix} Middle`, sub: `(${percent(regionConfig?.middle_pct ?? 0.8)})` }

  const write = (
    text: string,
    x: number,
    y: number,
    font: string,
    color = ink,
    align: CanvasTextAlign = 'left',
  ) => {
    ctx.fillStyle = color
    ctx.font = font
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y)
  }

  const writeMultiline = (
    lines: string[],
    x: number,
    y: number,
    mainFont: string,
    subFont: string,
    color = ink,
    align: CanvasTextAlign = 'center',
    lineGap = 18,
  ) => {
    const filtered = lines.filter(Boolean)
    const startY = y - ((filtered.length - 1) * lineGap) / 2
    filtered.forEach((line, idx) => {
      write(line, x, startY + idx * lineGap, idx === 0 ? mainFont : subFont, color, align)
    })
  }

  // Fixed 0-100% teal selection-rate scale shared by cells and the colorbar.
  function rateColor(rate: number): string {
    const stops = [[247, 252, 250], [198, 232, 221], [107, 190, 167], [19, 115, 109], [10, 62, 78]]
    const position = Math.min(1, Math.max(0, rate)) * (stops.length - 1)
    const i = Math.min(Math.floor(position), stops.length - 2)
    const t = position - i
    return `rgb(${stops[i].map((v, channel) => Math.round(v + t * (stops[i + 1][channel] - v))).join(',')})`
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)


  const left = 255
  const top = 110
  const cw = 220
  const ch = 160
  const gap = 12
  const gridRight = left + 3 * cw + 2 * gap
  const gridBottom = top + 3 * ch + 2 * gap

  // Publication heatmap legend: selection rate (selected edges / edges in region).
  const legendX = gridRight + 45
  const legendY = top
  const legendWidth = 26
  const legendHeight = gridBottom - top
  const legendGradient = ctx.createLinearGradient(0, legendY + legendHeight, 0, legendY)
  const legendStops = [
    [0, '#f7fcfa'], [0.25, '#c6e8dd'], [0.5, '#6bbea7'],
    [0.75, '#13736d'], [1, '#0a3e4e'],
  ] as const
  legendStops.forEach(([value, color]) => legendGradient.addColorStop(value, color))
  ctx.fillStyle = legendGradient
  ctx.fillRect(legendX, legendY, legendWidth, legendHeight)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = 1
  ctx.strokeRect(legendX, legendY, legendWidth, legendHeight)
  ;[0, 0.25, 0.5, 0.75, 1].forEach(value => {
    const tickY = legendY + legendHeight * (1 - value)
    ctx.beginPath()
    ctx.moveTo(legendX + legendWidth, tickY)
    ctx.lineTo(legendX + legendWidth + 6, tickY)
    ctx.stroke()
    write(`${Math.round(value * 100)}%`, legendX + legendWidth + 12, tickY,
      '14px Arial, sans-serif', muted)
  })
  write('Selection rate', legendX + legendWidth / 2, legendY - 30,
    'bold 15px Arial, sans-serif', muted, 'center')

  regions.forEach((region, c) => {
    const label = axisLabel('LP', region)
    writeMultiline([label.main, label.sub], left + c * (cw + gap) + cw / 2, 75,
      'bold 16px Arial, sans-serif', '14px Arial, sans-serif', muted, 'center', 18)
  })

  regions.forEach((pa, r) => {
    const y = top + r * (ch + gap)
    const label = axisLabel('PA', pa)
    writeMultiline([label.main, label.sub], left - 72, y + ch / 2, 'bold 16px Arial, sans-serif', '14px Arial, sans-serif', muted, 'center', 18)
    regions.forEach((lp, c) => {
      const x = left + c * (cw + gap)
      const cell = profile.joint_grid.find(item => item.pa_region === pa && item.lp_region === lp)
      const count = cell?.selected_count ?? 0
      const total = cell?.total_count ?? 0
      const rate = total > 0 ? count / total : null
      ctx.fillStyle = rate === null ? '#f2f4f5' : rateColor(rate)
      ctx.fillRect(x, y, cw, ch)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.strokeRect(x, y, cw, ch)

      const darkCell = rate !== null && rate >= 0.62
      const mainColor = darkCell ? '#ffffff' : ink
      const subColor = darkCell ? '#eaf8f3' : muted

      write(`${count}/${total}`, x + cw / 2, y + 58, 'bold 30px Arial, sans-serif', mainColor, 'center')
      write(rate === null ? 'N/A' : percent(rate), x + cw / 2, y + 105,
        'bold 24px Arial, sans-serif', mainColor, 'center')
      write(rate === null ? '' : 'selected', x + cw / 2, y + 138,
        '16px Arial, sans-serif', subColor, 'center')
    })
  })

  canvas.toBlob(blob => {
    if (!blob) { window.alert('Unable to generate the heatmap PNG.'); return }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pa-lp-fingerprint-heatmap.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
  }, 'image/png')
}
