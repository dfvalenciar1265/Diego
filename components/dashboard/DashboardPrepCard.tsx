'use client'
import { useState, useTransition } from 'react'
import { updateTaskNotes } from '@/actions/tasks'
import { NotifyBuildingButton } from './NotifyBuildingButton'
import type { Task } from '@/lib/types'

export type PrepTask = Task & {
  property?: { name: string }
  reservation?: {
    check_in: string
    check_out: string
    notes: string | null
    guest_name: string | null
    guests: number | null
  } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function reservationTimeTo24h(notes: string | null): string {
  if (!notes) return ''
  const re = /Check-in:\s*(\d+)(?::(\d+))?\s*(a|p)\.?m?\.?/i
  const m = notes.match(re)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const mins = m[2] ?? '00'
  if (m[3].toLowerCase() === 'p' && h !== 12) h += 12
  if (m[3].toLowerCase() === 'a' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${mins}`
}

function shortDate(iso: string): string {
  const [, mm, dd] = iso.split('-')
  const months = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${parseInt(dd)} ${months[parseInt(mm)]}`
}

function to12h(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

function parseAnnotation(raw: string | null): { time24: string; note: string } {
  if (!raw) return { time24: '', note: '' }
  const m = raw.match(/^(\d{2}:\d{2})\|(.*)$/s)
  if (m) return { time24: m[1], note: m[2] }
  if (raw.startsWith('Preparación para')) return { time24: '', note: '' }
  return { time24: '', note: raw }
}

function buildAnnotation(time24: string, note: string): string {
  if (time24 && note) return `${time24}|${note}`
  if (time24) return `${time24}|`
  return note
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardPrepCard({ task }: { task: PrepTask }) {
  const res      = task.reservation
  const resNotes = res?.notes ?? null

  const defaultTime = reservationTimeTo24h(resNotes) || '15:00'
  const { time24: savedTime, note: savedNote } = parseAnnotation(task.notes)

  const [editingTime, setEditingTime] = useState(false)
  const [ciTime, setCiTime]           = useState(savedTime || defaultTime)
  const [noteText, setNoteText]       = useState(savedNote)
  const [saveError, setSaveError]     = useState(false)
  const [, startTransition]           = useTransition()

  function save(time: string, note: string) {
    setSaveError(false)
    startTransition(async () => {
      try {
        const res = await updateTaskNotes(task.id, buildAnnotation(time, note))
        if (!res.success) setSaveError(true)
      } catch {
        setSaveError(true)
      }
    })
  }

  const guestName = res?.guest_name ?? '—'
  const propName  = task.property?.name ?? '—'
  const checkIn   = res?.check_in ? shortDate(res.check_in) : null
  const guests    = res?.guests ?? null

  const isDone = task.status === 'done'

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-3 py-2.5
                     ${isDone ? 'border-[#22c55e33] opacity-75' : 'border-[#ff385c22]'}`}>

      {/* Row 1: icon + apartment + check-in time */}
      <div className="flex items-center gap-2">
        <span className="text-base flex-shrink-0">{isDone ? '✅' : '🛏️'}</span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0f172a] leading-tight truncate">{propName}</p>
          <p className="text-xs text-[#94a3b8] truncate">{guestName}</p>
          {(guests != null || checkIn) && (
            <p className="text-[11px] text-[#94a3b8] leading-tight mt-0.5">
              {guests != null && <span>👥 {guests}</span>}
              {guests != null && checkIn && <span> · </span>}
              {checkIn && <span className="text-[#ff385c] font-medium">check-in {checkIn}</span>}
            </p>
          )}
        </div>

        {/* Editable check-in time */}
        <div className="flex-shrink-0">
          {editingTime ? (
            <input
              type="time"
              autoFocus
              value={ciTime}
              onChange={e => setCiTime(e.target.value)}
              onBlur={() => { setEditingTime(false); save(ciTime, noteText) }}
              className="text-xs border border-[#ff385c] rounded-lg px-2 py-1
                         focus:outline-none bg-white w-[90px]"
            />
          ) : (
            <button
              onClick={() => setEditingTime(true)}
              className="flex items-center gap-1 bg-[#fff0f2] px-2.5 py-1 rounded-lg
                         active:opacity-60 transition-opacity"
            >
              <span className="text-xs font-semibold text-[#ff385c]">
                {ciTime ? to12h(ciTime) : '+ hora'}
              </span>
              <span className="text-[10px]">✏️</span>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: note textarea */}
      <textarea
        rows={1}
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        onBlur={() => save(ciTime, noteText)}
        placeholder="Nota…"
        className="mt-2 w-full text-xs border border-[#e2e8f0] rounded-lg px-2.5 py-1.5
                   focus:outline-none focus:ring-1 focus:ring-[#ff385c] bg-[#fafafa]
                   resize-none placeholder:text-[#c4c9d4]"
      />

      {saveError && (
        <p className="mt-1.5 text-[11px] text-[#ef4444]">
          ⚠️ No se guardó. Revisa tu conexión.
        </p>
      )}

      {/* Avisar al edificio del ingreso del huésped (solo admin) */}
      {res?.check_in && res?.check_out && (
        <NotifyBuildingButton
          data={{
            apartment: propName,
            guestName: res.guest_name ?? '—',
            checkIn:   res.check_in,
            checkOut:  res.check_out,
            guests:    res.guests ?? null,
          }}
        />
      )}

    </div>
  )
}
