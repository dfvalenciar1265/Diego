'use client'
import { useState, useTransition } from 'react'
import { updateMaintenanceStatus } from '@/actions/maintenance'
import type { MaintenanceIssue } from '@/lib/types'

type ScheduledIssue = MaintenanceIssue & { property?: { name: string } }

interface Props { issue: ScheduledIssue }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses description stored as "interval:3|last:2026-01-10|next:2026-06-02"
 */
function parseMeta(desc: string): { interval: number | null; last: string | null; next: string | null } {
  const get = (key: string) => desc.match(new RegExp(`${key}:([^|]+)`))?.[1] ?? null
  const interval = get('interval')
  return {
    interval: interval ? parseInt(interval, 10) : null,
    last:     get('last'),
    next:     get('next'),
  }
}

/** "2026-06-15" → "15 jun 2026" */
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10)]} ${y}`
}

/** Returns 'overdue' | 'soon' | 'ok' | 'unknown' based on next date */
function urgency(next: string | null): 'overdue' | 'soon' | 'ok' | 'unknown' {
  if (!next) return 'unknown'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(next + 'T00:00:00')
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)  return 'overdue'
  if (diff <= 14) return 'soon'
  return 'ok'
}

const URGENCY_COLOR   = { overdue: '#ef4444', soon: '#f97316', ok: '#22c55e', unknown: '#94a3b8' }
const URGENCY_BG      = { overdue: '#fee2e2', soon: '#fff7ed', ok: '#f0fdf4', unknown: '#f8fafc' }
const URGENCY_LABEL   = { overdue: 'Vencido', soon: 'Próximo', ok: 'Al día', unknown: 'Sin fecha' }

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduledCard({ issue }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const meta   = parseMeta(issue.description ?? '')
  const level  = urgency(meta.next)
  const color  = URGENCY_COLOR[level]
  const isAire = issue.title.toLowerCase().startsWith('aire')
  const icon   = isAire ? '❄️' : '🐛'

  function markDone() {
    setError('')
    startTransition(async () => {
      const res = await updateMaintenanceStatus(issue.id, 'resolved')
      if (!res.success) setError('No se pudo marcar. Revisa tu conexión.')
    })
  }

  return (
    <div
      className="bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4"
      style={{ borderColor: `${color}44` }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: URGENCY_BG[level] }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#0f172a] text-sm leading-tight">{issue.title}</p>
          <p className="text-xs text-[#94a3b8] truncate">{issue.property?.name ?? '—'}</p>
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${color}22`, color }}
        >
          {URGENCY_LABEL[level]}
        </span>
      </div>

      {/* Dates + meta */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1">PRÓXIMO</p>
          <p className="text-sm font-bold" style={{ color }}>{fmtDate(meta.next)}</p>
        </div>
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1">ÚLTIMO</p>
          <p className="text-sm font-bold text-[#0f172a]">{fmtDate(meta.last)}</p>
        </div>
      </div>

      {/* Interval + cost */}
      <div className="flex items-center gap-3 text-xs text-[#64748b]">
        {meta.interval && (
          <span>🔁 Cada {meta.interval} meses</span>
        )}
        {issue.cost != null && (
          <span>💰 ${issue.cost.toLocaleString('es-CO')}</span>
        )}
      </div>

      {/* Mark done */}
      {issue.status !== 'resolved' && (
        <button
          onClick={markDone}
          disabled={isPending}
          className="mt-3 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#22c55e' }}
        >
          {isPending ? '…' : '✓ Marcar como hecho'}
        </button>
      )}

      {error && (
        <p className="mt-2 text-xs text-[#ef4444]">⚠️ {error}</p>
      )}
    </div>
  )
}
