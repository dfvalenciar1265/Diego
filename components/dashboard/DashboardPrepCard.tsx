'use client'
import { useState, useTransition } from 'react'
import { updateTaskNotes } from '@/actions/tasks'
import type { Task } from '@/lib/types'

type PrepTask = Task & {
  property?: { name: string }
  reservation?: {
    check_in: string
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

  const defaultTime = reservationTimeTo24h(resNotes)
  const { time24: savedTime, note: savedNote } = parseAnnotation(task.notes)

  const [editingTime, setEditingTime] = useState(false)
  const [ciTime, setCiTime]           = useState(savedTime || defaultTime)
  const [noteText, setNoteText]       = useState(savedNote)
  const [, startTransition]           = useTransition()

  function save(time: string, note: string) {
    startTransition(async () => {
      await updateTaskNotes(task.id, buildAnnotation(time, note))
    })
  }

  const guestName  = res?.guest_name ?? '—'
  const propName   = task.property?.name ?? '—'

  return (
    <div className="bg-white rounded-xl border border-[#ff385c22] shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-3 py-2.5">

      {/* Row 1: icon + apartment + check-in time */}
      <div className="flex items-center gap-2">
        <span className="text-base flex-shrink-0">🛏️</span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0f172a] leading-tight truncate">{propName}</p>
          <p className="text-xs text-[#94a3b8] truncate">{guestName}</p>
        </div>

        {/* Editable check-in time — inline on the right */}
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

    </div>
  )
}
