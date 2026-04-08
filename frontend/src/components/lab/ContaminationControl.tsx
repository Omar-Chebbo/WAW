import React, { useEffect, useMemo, useState } from 'react'

type ControlMode = 'auto' | 'manual'

interface Props {
  mode: ControlMode
  appliedMode: ControlMode
  draftValue: number
  appliedValue?: number | null
  disabled?: boolean
  defaultManualValue?: number
  onModeChange: (mode: ControlMode) => void
  onDraftChange: (value: number) => void
  onApply: () => void
  onResetDraft: () => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export default function ContaminationControl({
  mode,
  appliedMode,
  draftValue,
  appliedValue,
  disabled = false,
  defaultManualValue = 0.1,
  onModeChange,
  onDraftChange,
  onApply,
  onResetDraft,
}: Props) {
  const [minValue, setMinValue] = useState(0.01)
  const [maxValue, setMaxValue] = useState(0.5)
  const [stepValue, setStepValue] = useState(0.01)
  const [localInput, setLocalInput] = useState(draftValue.toFixed(2))

  useEffect(() => {
    setLocalInput(draftValue.toFixed(2))
  }, [draftValue])

  const safeStep = useMemo(() => {
    return stepValue > 0 ? stepValue : 0.01
  }, [stepValue])

  const safeMin = useMemo(() => {
    return minValue < maxValue ? minValue : maxValue - safeStep
  }, [minValue, maxValue, safeStep])

  const safeMax = useMemo(() => {
    const capped = Math.min(maxValue, 0.5)
    return capped > safeMin ? capped : safeMin + safeStep
  }, [maxValue, safeMin, safeStep])

  function commitTextInput() {
    const parsed = Number(localInput)
    if (Number.isNaN(parsed)) {
      setLocalInput(draftValue.toFixed(2))
      return
    }
    const clamped = clamp(parsed, safeMin, safeMax)
    onDraftChange(clamped)
    setLocalInput(clamped.toFixed(2))
  }

  function handleSliderChange(value: number) {
    const clamped = clamp(value, safeMin, safeMax)
    onDraftChange(clamped)
    setLocalInput(clamped.toFixed(2))
  }

  const appliedLabel =
    appliedMode === 'auto'
      ? 'Auto'
      : (appliedValue ?? draftValue).toFixed(2)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
        <div>
          <div className="text-sm font-semibold text-navy mb-1">
            Isolation Forest Contamination Control
          </div>
          <p className="text-xs text-gray-500 leading-5 max-w-3xl">
            <strong>Auto</strong> keeps the backend default. <strong>Manual</strong> lets you choose a valid sklearn contamination value.
            Nothing reruns until you press <strong>Apply</strong>.
          </p>
          <p className="text-xs text-amber-700 mt-2">
            Valid manual contamination range: <strong>(0, 0.5]</strong>.
          </p>
        </div>

        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <div>
            <span className="font-semibold text-gray-700">Applied mode:</span>{' '}
            {appliedMode === 'auto' ? 'Auto' : 'Manual'}
          </div>
          <div className="mt-1">
            <span className="font-semibold text-gray-700">Applied value:</span>{' '}
            {appliedLabel}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <div className="text-xs font-semibold text-gray-700 mb-3">Mode</div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onModeChange('auto')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                mode === 'auto'
                  ? 'bg-navy text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              Auto
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => onModeChange('manual')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                mode === 'manual'
                  ? 'bg-teal text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              Manual
            </button>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <div className="text-xs font-semibold text-gray-700 mb-3">Manual value</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              disabled={disabled || mode !== 'manual'}
              value={localInput}
              onChange={(e) => setLocalInput(e.target.value)}
              onBlur={commitTextInput}
              step={safeStep}
              min={safeMin}
              max={safeMax}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={disabled || mode !== 'manual'}
              onClick={commitTextInput}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              Set
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Default manual value: {defaultManualValue.toFixed(2)}
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <div className="text-xs font-semibold text-gray-700 mb-3">Range control</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Min</label>
              <input
                type="number"
                value={minValue}
                step={0.01}
                onChange={(e) => setMinValue(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Max</label>
              <input
                type="number"
                value={maxValue}
                step={0.01}
                onChange={(e) => setMaxValue(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Step</label>
              <input
                type="number"
                value={stepValue}
                step={0.01}
                onChange={(e) => setStepValue(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <div className="text-xs font-semibold text-gray-700 mb-2">Slider</div>
        <input
          type="range"
          min={safeMin}
          max={safeMax}
          step={safeStep}
          value={clamp(draftValue, safeMin, safeMax)}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          disabled={disabled || mode !== 'manual'}
          className="w-full accent-teal"
        />

        <div className="flex justify-between text-xs text-gray-400 mt-2">
          <span>{safeMin.toFixed(2)}</span>
          <span className="font-semibold text-gray-700">
            draft = {draftValue.toFixed(2)}
          </span>
          <span>{safeMax.toFixed(2)}</span>
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          <button
            type="button"
            disabled={disabled}
            onClick={onApply}
            className="px-4 py-2 rounded-lg bg-teal text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {mode === 'auto' ? 'Apply auto' : 'Apply manual value'}
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onResetDraft}
            className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Reset draft
          </button>
        </div>
      </div>
    </div>
  )
}