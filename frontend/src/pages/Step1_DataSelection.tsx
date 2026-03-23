/**
 * pages/Step1_DataSelection.tsx
 * User picks a pre-loaded dataset OR uploads their own CSV.
 * Shows a live graph preview + stats after selection.
 */
import React, { useState } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { useDatasets, fetchDatasetPreview, fetchDatasetStats, uploadDataset } from '../api/client'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import { StepCard, Button, StatCard, Toast } from '../components/ui'
import type { GraphData, GraphStats } from '../types'

export default function Step1() {
  const { datasetId, setDataset, goToStep } = useWorkflowStore()

  const { data: datasets = [], isLoading } = useDatasets()

  const [selectedId,  setSelectedId]  = useState<string | null>(datasetId)
  const [isCustom,    setIsCustom]    = useState(false)
  const [preview,     setPreview]     = useState<GraphData | null>(null)
  const [stats,       setStats]       = useState<GraphStats | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [toast,       setToast]       = useState<string | null>(null)
  const [dragging,    setDragging]    = useState(false)

  // When user clicks a pre-loaded dataset card
  async function selectPreloaded(id: string) {
    setLoading(true)
    setIsCustom(false)
    setSelectedId(id)
    try {
      const [p, s] = await Promise.all([
        fetchDatasetPreview(id),
        fetchDatasetStats(id)
      ])
      setPreview(p)
      setStats(s)
    } catch {
      setToast('Could not load dataset preview.')
    }
    setLoading(false)
  }

  // When user uploads a custom CSV
  async function handleUpload(file: File) {
    if (!file.name.endsWith('.csv')) {
      setToast('Only CSV files are accepted.')
      return
    }
    setLoading(true)
    try {
      const result = await uploadDataset(file)
      setIsCustom(true)
      setSelectedId(result.dataset_id)
      setStats(result.stats)
      const p = await fetchDatasetPreview(result.dataset_id, true)
      setPreview(p)
    } catch (e: any) {
      setToast(e?.response?.data?.detail ?? 'Upload failed. Check the file format.')
    }
    setLoading(false)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }

  function handleNext() {
    if (!selectedId || !stats) return
    setDataset(selectedId, isCustom, stats)
    goToStep(2)
  }

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast} type="error" onClose={() => setToast(null)} />}

      <StepCard stepNumber={1} title="Select a Dataset"
        subtitle="Choose a pre-loaded network or upload your own CSV edge list.">

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pre-loaded datasets */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Pre-loaded Networks
            </h3>
            {isLoading ? (
              <div className="text-sm text-gray-400 py-4">Loading…</div>
            ) : (
              <div className="space-y-2">
                {datasets.map(ds => (
                  <button
                    key={ds.id}
                    onClick={() => selectPreloaded(ds.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      selectedId === ds.id && !isCustom
                        ? 'border-teal bg-teal-bg'
                        : 'border-gray-100 bg-white hover:border-teal/40'
                    }`}
                  >
                    <div className="font-semibold text-navy text-sm">{ds.filename}</div>
                    <div className="text-xs text-gray-500 mt-1 flex gap-3">
                      <span>{ds.stats.nodes?.toLocaleString() ?? '—'} nodes</span>
                      <span>{ds.stats.edges?.toLocaleString() ?? '—'} edges</span>
                      {ds.stats.is_weighted && <span className="text-teal">weighted</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Upload */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Upload Your Own
            </h3>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                dragging ? 'border-teal bg-teal-bg' :
                selectedId && isCustom ? 'border-teal bg-teal-bg' :
                'border-gray-200 hover:border-teal/50'
              }`}
              onClick={() => document.getElementById('csv-upload')?.click()}
            >
              <input
                id="csv-upload" type="file" accept=".csv"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
              <div className="text-3xl mb-2">📂</div>
              {selectedId && isCustom ? (
                <div className="text-sm text-teal font-medium">
                  ✓ File uploaded successfully
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-600">Drag & drop a CSV file here</div>
                  <div className="text-xs text-gray-400 mt-1">or click to browse</div>
                  <div className="text-xs text-gray-400 mt-3">
                    Required columns: <code className="bg-gray-100 px-1 rounded">source</code>,{' '}
                    <code className="bg-gray-100 px-1 rounded">target</code>,{' '}
                    <code className="bg-gray-100 px-1 rounded">weight</code>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Stats + Preview */}
        {stats && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Network Statistics
            </h3>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <StatCard label="Nodes"       value={stats.nodes.toLocaleString()} />
              <StatCard label="Edges"       value={stats.edges.toLocaleString()} />
              <StatCard label="Density"     value={stats.density.toFixed(4)} />
              <StatCard label="Avg Degree"  value={stats.avg_degree} />
              <StatCard label="Components"  value={stats.components} />
              <StatCard label="Weighted"    value={stats.is_weighted ? 'Yes' : 'No'} />
            </div>

            {preview && (
              <>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Graph Preview {preview.sampled && <span className="font-normal">(sampled)</span>}
                </h3>
                <GraphCanvas data={preview} height={340} />
              </>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-end mt-6">
          <Button onClick={handleNext} disabled={!selectedId || !stats} loading={loading}>
            Next: Select Methods →
          </Button>
        </div>
      </StepCard>
    </div>
  )
}
