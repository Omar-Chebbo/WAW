/**
 * components/ui/index.tsx
 * Small reusable building blocks used across all pages.
 */
import React, { useEffect } from 'react'
import clsx from 'clsx'
import type { MethodId } from '../../types'
import { METHOD_MAP } from '../../constants/methods'

// ── Method Badge ──────────────────────────────────────────────────
export function MethodBadge({ id }: { id: MethodId }) {
  const m = METHOD_MAP[id]
  if (!m) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-gray-200">{id.toUpperCase()}</span>
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-bold text-white"
      style={{ backgroundColor: m.color }}
    >
      {m.short}
    </span>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────
export function StatCard({
  label, value, sub
}: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-navy">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

// ── Step Card wrapper ─────────────────────────────────────────────
export function StepCard({
  stepNumber, title, subtitle, children
}: {
  stepNumber: number; title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-full bg-teal flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          {stepNumber}
        </div>
        <div>
          <h2 className="text-xl font-bold text-navy">{title}</h2>
          {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────
export function Button({
  onClick, disabled, loading, variant = 'primary', children, className
}: {
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  children: React.ReactNode
  className?: string
}) {
  const base = 'px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2'
  const variants = {
    primary:   'bg-teal text-white hover:bg-teal-light disabled:opacity-40',
    secondary: 'bg-white text-navy border border-gray-200 hover:bg-gray-50 disabled:opacity-40',
    danger:    'bg-coral text-white hover:bg-coral-light disabled:opacity-40',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(base, variants[variant], className)}
    >
      {loading && (
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
      )}
      {children}
    </button>
  )
}

// ── Progress Bar ──────────────────────────────────────────────────
export function ProgressBar({
  method, progress, message
}: { method?: string; progress: number; message: string }) {
  const m = method ? METHOD_MAP[method] : null
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span className="flex items-center gap-2">
          {m && <MethodBadge id={method!} />}
          <span>{message}</span>
        </span>
        <span className="font-medium">{progress}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            backgroundColor: m?.color ?? '#0F6E56'
          }}
        />
      </div>
    </div>
  )
}

// ── Toast notification ────────────────────────────────────────────
export function Toast({
  message, type = 'info', onClose
}: { message: string; type?: 'success' | 'error' | 'info'; onClose: () => void }) {
  const colours = {
    success: 'bg-teal-bg border-teal text-teal',
    error:   'bg-coral-bg border-coral text-coral',
    info:    'bg-purple-bg border-purple text-purple',
  }
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={clsx('fixed top-4 right-4 z-50 px-4 py-3 rounded-lg border text-sm font-medium shadow-md', colours[type])}>
      {message}
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────
export function Divider() {
  return <hr className="border-gray-100 my-6" />
}

// ── Empty state ───────────────────────────────────────────────────
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-400 text-sm">{message}</div>
  )
}
