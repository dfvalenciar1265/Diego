'use client'
import { useState, useTransition } from 'react'
import { updateTaskStatus, updateTaskNotes } from '@/actions/tasks'
import type { Task } from '@/lib/types'

type PrepTask = Task & {
  property?: { name: string }
  assignee?: { name: string }
  reservation?: {
    check_in: string
    check_out: string
    notes: string | null
    guest_name: string | null
  } | null
}

interface Props {
  task: PrepTask
}

/** Parses reservation notes to extract a field value.
 *  Notes format: "Huéspedes: 4 | Cancelación: Moderada | Check-in: 3:00 p.m. | Check-out: 12:00 p.m."
 */
function parseNote(notes: string | null | undefined, key: string): string {
  if (!notes) return '—'
  const match = notes.match(new RegExp(`${key}:\\s*([^|]+)`, 'i'))
  return match ? match[1].trim() : '—'
}

function formatDateShort(iso: string | undefined): string {
  if (!iso) return '—'
  const [, mm, dd] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
                  'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(dd, 10)} ${months[parseInt(mm, 10)]}`
}

export function PrepTaskCard({ task }: Props) {
  const [isPending, startTransition] = useTransition()
  const [noteValue, setNoteValue] = useState(task.notes ?? '')
  const [saved, setSaved] = useState(false)

  const res = task.reservation
  const resNotes = res?.notes ?? null
  const guests    = parseNote(resNotes, 'Huéspedes')
  const ciTime    = parseNote(resNotes, 'Check-in')
  const checkIn   = res?.check_in
  const checkOut  = res?.check_out
  const guestName = res?.guest_name ?? task.property?.name ?? '—'

  const isDone = task.status === 'done'

  function complete() {
    startTransition(async () => { await updateTaskStatus(task.id, 'done') })
  }

  function saveNote() {
    startTransition(async () => {
      await updateTaskNotes(task.id, noteValue)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4
                     ${isDone ? 'border-[#22c55e] opacity-70' : 'border-[#ff385c33]'}`}>

      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-[#fff0f2]">
          🛏️
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#0f172a] text-sm leading-tight">
            {task.property?.name ?? '—'}
          </p>
          <p className="text-xs text-[#94a3b8] mt-0.5 truncate">{guestName}</p>
        </div>
        {isDone && (
          <span className="text-xs font-semibold text-[#22c55e] flex-shrink-0">✓ Listo</span>
        )}
      </div>

      {/* Reservation details grid */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[#f8fafc] rounded-lg p-2.5">
          <p className="text-[#94a3b8] font-medium mb-0.5">Check-in</p>
          <p className="font-semibold text-[#0f172a]">{formatDateShort(checkIn)}</p>
          <p className="text-[#64748b]">{ciTime}</p>
        </div>
        <div className="bg-[#f8fafc] rounded-lg p-2.5">
          <p className="text-[#94a3b8] font-medium mb-0.5">Check-out</p>
          <p className="font-semibold text-[#0f172a]">{formatDateShort(checkOut)}</p>
          <p className="text-[#64748b]">12:00 p.m.</p>
        </div>
      </div>

      {/* Guests */}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-[#64748b]">
        <span>👥</span>
        <span>{guests} huésped{guests !== '1' ? 'es' : ''}</span>
      </div>

      {/* Editable check-in time note */}
      {!isDone && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wide mb-1">
            ✏️ Hora de llegada / Nota
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={noteValue}
              onChange={e => setNoteValue(e.target.value)}
              placeholder="Ej: llegarán a las 4pm, llevan mascota…"
              className="flex-1 text-xs border border-[#e2e8f0] rounded-lg px-3 py-2
                         focus:outline-none focus:ring-1 focus:ring-[#ff385c] bg-[#fafafa]"
            />
            <button
              onClick={saveNote}
              disabled={isPending || noteValue === task.notes}
              className="text-xs px-3 py-2 rounded-lg font-medium transition-colors
                         disabled:opacity-40"
              style={{ background: saved ? '#22c55e' : '#6366f1', color: 'white' }}
            >
              {saved ? '✓' : isPending ? '…' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {/* Completar button — no Iniciar for prep tasks */}
      {!isDone && (
        <button
          onClick={complete}
          disabled={isPending}
          className="mt-3 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#22c55e' }}
        >
          {isPending ? '…' : '✓ Marcar como lista'}
        </button>
      )}

      {isDone && task.completed_at && (
        <p className="mt-2 text-xs text-[#22c55e] text-center">
          ✅ Completado
        </p>
      )}
    </div>
  )
}
