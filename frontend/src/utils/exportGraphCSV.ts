import type { GraphData, GraphLink } from '../types'

/**
 * Resolve source/target from a GraphLink — D3 may replace string IDs
 * with node objects after a force simulation, so we handle both.
 */
function resolveId(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}

function triggerDownload(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Download edges CSV for the Score Extremes view.
 * Columns: source, target, weight, score, score_region
 */
export function downloadScoreExtremesCSV(
  graph: GraphData,
  datasetId: string,
  methodShort: string
) {
  const header = 'source,target,weight,score,score_region'
  const rows = graph.links.map((link) => {
    const source = resolveId(link.source)
    const target = resolveId(link.target)
    const weight = link.weight ?? 1
    const score = (link as any).score ?? ''
    const score_region = (link as any).score_region ?? 'normal'
    return `${source},${target},${weight},${score},${score_region}`
  })
  const csv = [header, ...rows].join('\n')
  const filename = `${datasetId}-${methodShort}-score-extremes.csv`
  triggerDownload(csv, filename)
}

/**
 * Download edges CSV for the IF Backbone view.
 * Columns: source, target, weight, score, is_if_backbone
 */
export function downloadIfBackboneCSV(
  graph: GraphData,
  datasetId: string,
  methodShort: string
) {
  const header = 'source,target,weight,score,is_if_backbone'
  const rows = graph.links.map((link) => {
    const source = resolveId(link.source)
    const target = resolveId(link.target)
    const weight = link.weight ?? 1
    const score = (link as any).score ?? ''
    const is_if_backbone = (link as any).is_if_backbone ?? false
    return `${source},${target},${weight},${score},${is_if_backbone}`
  })
  const csv = [header, ...rows].join('\n')
  const filename = `${datasetId}-${methodShort}-if-backbone.csv`
  triggerDownload(csv, filename)
}
