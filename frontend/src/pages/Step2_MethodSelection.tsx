/**
 * pages/Step2_MethodSelection.tsx
 * User picks which backbone algorithms to run.
 */
import React, { useState } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { METHODS } from '../constants/methods'
import { StepCard, Button } from '../components/ui'
import type { MethodId } from '../types'

export default function Step2() {
  const { selectedMethods, setSelectedMethods, goToStep } = useWorkflowStore()
  const [selected, setSelected] = useState<Set<MethodId>>(new Set(selectedMethods))

  function toggleMethod(id: MethodId) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === METHODS.length) setSelected(new Set())
    else setSelected(new Set(METHODS.map(m => m.id)))
  }

  const needsAnomaly = METHODS.filter(m => selected.has(m.id) && m.requires_anomaly)

  function handleNext() {
    setSelectedMethods([...selected])
    goToStep(3)
  }

  return (
    <StepCard stepNumber={2} title="Select Backbone Methods"
      subtitle="Choose one or more methods. You can run all of them and compare results at the end.">

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">{selected.size} of {METHODS.length} selected</span>
        <button onClick={toggleAll} className="text-sm text-teal hover:underline">
          {selected.size === METHODS.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {METHODS.map(m => (
          <button key={m.id} onClick={() => toggleMethod(m.id)}
            className="p-5 rounded-xl border-2 text-left transition-all relative"
            style={selected.has(m.id)
              ? { borderColor: m.color, backgroundColor: m.color + '12' }
              : { borderColor: '#e5e7eb', backgroundColor: 'white' }}>

            {/* Checkbox */}
            <div className="absolute top-3 right-3 w-5 h-5 rounded border-2 flex items-center justify-center"
              style={selected.has(m.id)
                ? { backgroundColor: m.color, borderColor: m.color, color: 'white' }
                : { borderColor: '#d1d5db' }}>
              {selected.has(m.id) && <span className="text-xs font-bold">✓</span>}
            </div>

            <div className="text-2xl font-black mb-1" style={{ color: m.color }}>{m.short}</div>
            <div className="font-semibold text-navy text-sm mb-2">{m.label}</div>
            <div className="text-xs text-gray-500 leading-relaxed">{m.description}</div>

            {m.requires_anomaly && (
              <div className="mt-3 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#FAEEDA', color: '#BA7517' }}>
                ⚠ Requires anomaly labeling
              </div>
            )}
          </button>
        ))}
      </div>

      {needsAnomaly.length > 0 && (
        <div className="border rounded-lg p-3 text-sm mb-4"
          style={{ backgroundColor: '#FAEEDA', borderColor: '#BA751740', color: '#BA7517' }}>
          <strong>Note:</strong> Step 4 (Anomaly Labeling) will be active because{' '}
          {needsAnomaly.map(m => m.short).join(' and ')} require it.
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={() => goToStep(1)}>← Back</Button>
        <Button onClick={handleNext} disabled={selected.size === 0}>
          Next: Compute Scores →
        </Button>
      </div>
    </StepCard>
  )
}
