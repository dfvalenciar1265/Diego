'use client'
import { useState, useTransition } from 'react'
import { updateTaskNotes } from '@/actions/tasks'
import type { Task } from '@/lib/types'

type PrepTask = Task & {
  property?: { name: string }
  reservation?: {
    check_in: string
    check_out: string
    notes: string | null
    guest_name: string | null
  } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "3:00 p.m." → "15:00"  |  "12:00 p.m." → "12:00"  |  "" → "" */
function reservationTimeTo24h(notes: string | null, field: 'Check-in' | 'Check-out'): string {
  if (!notes) return ''
  const m = notes.match(new RegExp(`${field}:\\s*(\\d+):(\\d+)\\s*(a|p)\\.m\\.`, 'i'))
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const mins = m[2]
  const period = m[3].toLowerCase()
  if (period === 'p' && h !== 12) h += 12
  if (period === 'a' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${mins}`
}

/** "15:00" → "3:00 pm" */
function to12h(t: string): string {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

/** "2026-05-28" → "28 may" */
function shortDate(iso: string | undefined): string {
  if (!iso) return '—'
  const [, mm, dd] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(dd, 10)} ${months[parseInt(mm, 10)]}`
}

/** Parse task notes → { time24, note }
 *  Storage format: "HH:MM|freetext"
 *  Legacy (auto-generated): "Preparación para …" → ignored, start fresh
 */
function parseAnnotation(raw: string | null): { time24: string; note: string } {
  if (!raw) return { time24: '', note: '' }
  const m = raw.match(/^(\d{2}:\d{2})\|(.*)$/)
  if (m) return { time24: m[1], note: m[2] }
  if (raw.startsWith('Preparación para')) return { time24: '', note: '' }
  return { time24: '', note: raw }
}

function buildAnnotation(time24: string, note: string): string {
  return time24 ? `${time24}|${note}` : note
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { task: PrepTask }

export function PrepTaskCard({ task }: Props) {
  const res = task.reservation
  const resNotes = res?.notes ?? null

  const guestName = res?.guest_name ?? '—'
  const guests    = resNotes?.match(/Huéspedes:\s*(\d+)/i)?.[1] ?? '?'

  // Default times from reservation
  const defaultCiTime = reservationTimeTo24h(resNotes, 'Check-in')
  const defaultCoTime = reservationTimeTo24h(resNotes, 'Check-out')

  const { time24: savedTime, note: savedNote } = parseAnnotation(task.notes)

  const [editingTime, setEditingTime] = useState(false)
  const [ciTime, setCiTime]           = useState(savedTime || defaultCiTime)
  const [noteText, setNoteText]       = useState(savedNote)
  const [, startTransition]           = useTransition()

  function saveAnnotation(time: string, note: string) {
    const content = buildAnnotation(time, note)
    startTransition(async () => { await updateTaskNotes(task.id, content) })
  }

  return (
    <div className="bg-white rounded-xl border border-[#ff385c22] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">

      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-[#fff0f2]">
          🛏️
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[#0f172a] text-sm leading-tight">
            {task.property?.name ?? '—'}
          </p>
          <p className="text-xs text-[#94a3b8] truncate">{guestName}</p>
        </div>
      </div>

      {/* Dates row */}
      <div className="grid grid-cols-2 gap-2 mb-3">

        {/* Check-in — tap time to edit */}
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1">CHECK-IN</p>
          <p className="text-sm font-bold text-[#0f172a]">{shortDate(res?.check_in)}</p>
          {editingTime ? (
            <input
              type="time"
              autoFocus
              value={ciTime}
              onChange={e => setCiTime(e.target.value)}
              onBlur={() => {
                setEditingTime(false)
                saveAnnotation(ciTime, noteText)
              }}
              className="mt-1 text-xs border border-[#ff385c] rounded-md px-1 py-0.5
                         focus:outline-none w-full bg-white"
            />
          ) : (
            <button
              onClick={() => setEditingTime(true)}
              className="mt-1 text-xs font-medium text-[#ff385c] flex items-center gap-1 hover:underline"
            >
              {ciTime ? to12h(ciTime) : '+ hora'} ✏️
            </button>
          )}
        </div>

        {/* Check-out — display only, smaller */}
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1">CHECK-OUT</p>
          <p className="text-sm font-bold text-[#0f172a]">{shortDate(res?.check_out)}</p>
          <p className="mt-1 text-[10px] text-[#64748b]">
            {defaultCoTime ? to12h(defaultCoTime) : '12:00 pm'}
          </p>
        </div>
      </div>

      {/* Guests */}
      <p className="text-xs text-[#64748b] mb-3 flex items-center gap-1.5">
        <span>👥</span>
        <span>{guests} huésped{guests !== '1' ? 'es' : ''}</span>
      </p>

      {/* Note field — just the text, no label header */}
      <textarea
        rows={2}
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        onBlur={() => saveAnnotation(ciTime, noteText)}
        placeholder="Nota: mascota, llegada tardía, llave…"
        className="w-full text-xs border border-[#e2e8f0] rounded-xl px-3 py-2
                   focus:outline-none focus:ring-1 focus:ring-[#ff385c] bg-[#fafafa]
                   resize-none placeholder:text-[#c4c9d4]"
      />

    </div>
  )
}
