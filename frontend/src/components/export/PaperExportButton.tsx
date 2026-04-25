import React, { useEffect, useRef, useState } from 'react'
import { exportPaperFigure, type PaperExportFigureType, type PaperExportFormat } from '../../utils/paperExport'

export interface PaperExportConfig {
  figureType: PaperExportFigureType
  title: string
  filename?: string
  payload: Record<string, any>
}

export default function PaperExportButton({ config, className = '' }: { config: PaperExportConfig; className?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<PaperExportFormat | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [])

  async function doExport(format: PaperExportFormat) {
    setLoading(format)
    try {
      await exportPaperFigure({
        figure_type: config.figureType,
        format,
        title: config.title,
        filename: config.filename,
        payload: config.payload,
      })
      setOpen(false)
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Paper export failed.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-sm"
        title="Export as publication-style figure"
      >
        Export ▾
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-36 rounded-xl border border-gray-200 bg-white shadow-lg p-1.5">
          {(['pdf', 'svg', 'png'] as PaperExportFormat[]).map((format) => (
            <button
              key={format}
              disabled={loading !== null}
              onClick={() => void doExport(format)}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              {loading === format ? 'Exporting…' : format === 'png' ? 'PNG (600 dpi)' : format.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
