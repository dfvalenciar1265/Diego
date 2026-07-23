'use client'
import { useState, useTransition } from 'react'
import { applyReservationChange, dismissReservationChange } from '@/actions/reservations'
import type { PendingChange, Reservation } from '@/lib/types'

type ChangeReservation = Reservation & { property?: { name: string } | null }

/** "2026-08-02" → "2 ago" */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10)]}`
}

/**
 * One accepted guest change, waiting to be applied. Shows exactly what changes
 * so the admin never has to open Airbnb or the email — one tap applies it.
 */
export function PendingChangeCard({ reservation }: { reservation: ChangeReservation }) {
  const pc = reservation.pending_change as PendingChange | null
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  if (!pc) return null

  const rows: { label: string; from: string; to: string }[] = []
  if (pc.guests_to != null) {
    rows.push({
      label: 'Huéspedes',
      from: `${pc.guests_from ?? reservation.guests ?? '—'}`,
      to:   `${pc.guests_to}`,
    })
  }
  if (pc.check_in_to) {
    rows.push({ label: 'Check-in', from: shortDate(pc.check_in_from ?? reservation.check_in), to: shortDate(pc.check_in_to) })
  }
  if (pc.check_out_to) {
    rows.push({ label: 'Check-out', from: shortDate(pc.check_out_from ?? reservation.check_out), to: shortDate(pc.check_out_to) })
  }

  function run(fn: (id: string) => Promise<{ success: boolean; error?: string }>) {
    setError('')
    startTransition(async () => {
      const res = await fn(reservation.id)
      if (!res.success) setError(res.error ?? 'No se pudo. Reintenta.')
    })
  }

  return (
    <div className="bg-white border border-[#bfdbfe] rounded-xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0f172a] truncate">{reservation.guest_name}</p>
          <p className="text-[11px] text-[#94a3b8] truncate">{reservation.property?.name ?? '—'}</p>
        </div>
        <span className="text-[9px] font-bold text-[#1d4ed8] bg-[#eff6ff] px-1.5 py-0.5 rounded shrink-0">
          ACEPTADO EN AIRBNB
        </span>
      </div>

      {/* What changes */}
      <div className="mt-2 space-y-1">
        {rows.length === 0 ? (
          <p className="text-[11px] text-[#64748b]">{pc.description}</p>
        ) : rows.map(r => (
          <div key={r.label} className="flex items-center gap-2 text-[11px]">
            <span className="text-[#94a3b8] w-16 shrink-0">{r.label}</span>
            <span className="text-[#94a3b8] line-through">{r.from}</span>
            <span className="text-[#cbd5e1]">→</span>
            <span className="font-bold text-[#0f172a]">{r.to}</span>
          </div>
        ))}
      </div>

      {error && <p className="mt-1.5 text-[11px] text-[#ef4444]">⚠️ {error}</p>}

      <div className="flex gap-2 mt-2.5">
        <button
          onClick={() => run(applyReservationChange)}
          disabled={isPending}
          className="flex-1 h-8 rounded-lg text-xs font-semibold text-white active:opacity-80 disabled:opacity-50"
          style={{ background: '#2563eb' }}
        >
          {isPending ? '…' : '✓ Aplicar cambio'}
        </button>
        <button
          onClick={() => run(dismissReservationChange)}
          disabled={isPending}
          className="px-3 h-8 rounded-lg text-xs font-medium text-[#64748b] border border-[#e2e8f0] active:opacity-60 disabled:opacity-50"
        >
          Descartar
        </button>
      </div>
    </div>
  )
}
