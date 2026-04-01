export interface PngExportOptions {
  scale?: number
  backgroundColor?: string
}

function getSvgSize(svgEl: SVGSVGElement) {
  const rect = svgEl.getBoundingClientRect()

  const width =
    Math.max(
      1,
      Math.round(rect.width || Number(svgEl.getAttribute('width')) || 800)
    )

  const height =
    Math.max(
      1,
      Math.round(rect.height || Number(svgEl.getAttribute('height')) || 480)
    )

  return { width, height }
}

function buildSvgSource(svgEl: SVGSVGElement) {
  const { width, height } = getSvgSize(svgEl)

  const clone = svgEl.cloneNode(true) as SVGSVGElement

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }

  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(clone)

  return { source, width, height }
}

export function downloadSvgElement(svgEl: SVGSVGElement, filename: string) {
  const { source } = buildSvgSource(svgEl)
  const blob = new Blob([source], {
    type: 'image/svg+xml;charset=utf-8',
  })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadPngElement(
  svgEl: SVGSVGElement,
  filename: string,
  options: PngExportOptions = {}
) {
  const { scale = 4, backgroundColor = '#ffffff' } = options
  const { source, width, height } = buildSvgSource(svgEl)

  const blob = new Blob([source], {
    type: 'image/svg+xml;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)

  const img = new Image()
  img.decoding = 'sync'

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load SVG for PNG export'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    URL.revokeObjectURL(url)
    throw new Error('Canvas context unavailable')
  }

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.drawImage(img, 0, 0, width, height)

  const pngUrl = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = pngUrl
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function getSvgFromContainer(containerId: string) {
  const container = document.getElementById(containerId)
  if (!container) return null
  return container.querySelector('svg') as SVGSVGElement | null
}

export function downloadSvgByContainerId(containerId: string, filename: string) {
  const svgEl = getSvgFromContainer(containerId)
  if (!svgEl) return
  downloadSvgElement(svgEl, filename)
}

export async function downloadPngByContainerId(
  containerId: string,
  filename: string,
  scale = 4
) {
  const svgEl = getSvgFromContainer(containerId)
  if (!svgEl) return
  await downloadPngElement(svgEl, filename, { scale })
}