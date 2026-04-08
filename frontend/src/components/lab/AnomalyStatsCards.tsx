import React from 'react'
import type { AnomalySummary } from '../../types'

interface Props {
  summary: AnomalySummary
  color: string
}

function formatTransformName(id?: string | null) {
  if (!id) return 'Auto'
  if (id === 'raw') return 'None'

  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function AnomalyStatsCards({ summary, color }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold" style={{ color }}>
          {summary.flagged.toLocaleString()}
        </div>
        <div className="text-xs text-gray-500 mt-1">Backbone edges</div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-gray-700">{summary.pct}%</div>
        <div className="text-xs text-gray-500 mt-1">Edge fraction</div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-gray-700">{summary.total}</div>
        <div className="text-xs text-gray-500 mt-1">Total edges</div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <div className="text-lg font-bold text-gray-700">
          {summary.contamination ?? 'auto'}
        </div>
        <div className="text-xs text-gray-500 mt-1">Contamination</div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <div className="text-lg font-bold text-gray-700">
          {summary.threshold != null ? summary.threshold.toFixed(4) : '—'}
        </div>
        <div className="text-xs text-gray-500 mt-1">IF threshold</div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <div className="text-lg font-bold text-gray-700">
          {formatTransformName(summary.selected_transform)}
        </div>
        <div className="text-xs text-gray-500 mt-1">Preprocessing</div>
      </div>
    </div>
  )
}