import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export type PaperExportFormat = 'pdf' | 'svg' | 'png'
export type PaperExportFigureType = 'histogram' | 'line' | 'scatter' | 'bar' | 'ccdf' | 'graph' | 'graph_compare' | 'table' | 'radar'

export interface PaperExportRequest {
  figure_type: PaperExportFigureType
  format: PaperExportFormat
  title?: string
  filename?: string
  payload: Record<string, any>
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportPaperFigure(request: PaperExportRequest) {
  const res = await api.post('/exports/render', request, { responseType: 'blob' })
  const disposition = res.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/) || disposition?.match(/filename=([^;]+)/)
  const fallbackName = `${(request.filename || request.title || request.figure_type).replace(/\s+/g, '-').toLowerCase()}.${request.format}`
  downloadBlob(res.data, match?.[1] ?? fallbackName)
}
