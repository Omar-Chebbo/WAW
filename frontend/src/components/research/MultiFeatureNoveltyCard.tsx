import React from 'react'

/**
 * Shared novelty card and CSV schema for the Multi-Feature Study and the
 * Contamination Lab. The single-run CSV format is intentionally identical:
 * dataset,retention,novel_edges,multi_edges,novelty_fraction,novelty_percent
 */
export const NOVELTY_CSV_COLUMNS = [
  'dataset', 'retention', 'novel_edges', 'multi_edges', 'novelty_fraction', 'novelty_percent',
] as const

export type MultiFeatureNovelty = {
  value: number | null
  novel_edges: number
  multi_edges: number
}

export type NoveltyExportRow = {
  dataset: string
  retention: number
  novel_edges: number
  multi_edges: number
  novelty_fraction: number | null
  novelty_percent: number | null
}

export function makeNoveltyExportRow(dataset: string, retention: number, novelty: MultiFeatureNovelty): NoveltyExportRow {
  return {
    dataset,
    retention,
    novel_edges: novelty.novel_edges,
    multi_edges: novelty.multi_edges,
    novelty_fraction: novelty.value,
    novelty_percent: novelty.value === null ? null : novelty.value * 100,
  }
}

function csvEscape(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function downloadNoveltyCsv(filename: string, rows: NoveltyExportRow[]) {
  const lines = [
    [...NOVELTY_CSV_COLUMNS],
    ...rows.map((row) => NOVELTY_CSV_COLUMNS.map((column) => row[column])),
  ]
  const csv = lines.map((line) => line.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function noveltySafeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table'
}

export default function MultiFeatureNoveltyCard({
  novelty, datasetId, datasetLabel, retention, filename, contextLabel,
}: {
  novelty: MultiFeatureNovelty
  datasetId: string
  datasetLabel: string
  retention: number
  filename?: string
  contextLabel?: string
}) {
  const exportRow = makeNoveltyExportRow(datasetLabel, retention, novelty)
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 mb-4">
      <div className="text-sm font-semibold text-teal-900">Multi-Feature Novelty (Nρ)</div>
      {contextLabel ? <div className="text-xs font-semibold text-teal-800 mt-1">{contextLabel}</div> : null}
      <div className="text-3xl font-bold text-teal-900 mt-2">
        {novelty.value === null ? 'N/A' : `${(novelty.value * 100).toFixed(2)}%`}
      </div>
      <div className="text-sm text-teal-900 mt-1">
        {novelty.novel_edges} of {novelty.multi_edges} PA+LP backbone edges are new.
      </div>
      <p className="text-sm text-teal-900 mt-2 leading-6">
        This tells us what share of the PA+LP backbone was not found by PA alone or LP alone.
        Higher novelty means more different edges, not necessarily a better backbone.
        {novelty.value === null ? ' No PA+LP edges were selected, so novelty cannot be calculated.' : ''}
      </p>
      <div className="text-xs text-teal-800 mt-2">Nρ = PA+LP-only edges ÷ all PA+LP backbone edges; measured at the current selection level.</div>
      <button
        type="button"
        onClick={() => downloadNoveltyCsv(filename ?? `${noveltySafeFilename(datasetId)}_multifeature_novelty.csv`, [exportRow])}
        className="mt-3 text-xs font-semibold text-teal-900 underline underline-offset-2"
      >
        Export novelty CSV
      </button>
    </div>
  )
}
