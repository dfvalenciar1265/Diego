'use client'
import { useState, useTransition } from 'react'
import { updateTaskNotes } from '@/actions/tasks'
import type { TodayCheckOut } from '@/actions/dashboard'

/** "15:30" → "3:30pm" | "12:00" → "12pm" */
function to12h(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

export function CheckoutCard({ co }: { co: TodayCheckOut }) {
  const [time, setTime]       = useState(co.check_out_time_24)   // "HH:MM"
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState(false)
  const [, startTransition]   = useTransition()

  const canEdit = co.cleaning_task_id != null

  function save(next: string) {
    if (!co.cleaning_task_id) return
    setError(false)
    startTransition(async () => {
      try {
        // Stored on the cleaning task as "HH:MM|" — same field the Limpieza view uses
        const res = await updateTaskNotes(co.cleaning_task_id!, `${next}|`)
        if (!res.success) setError(true)
      } catch {
        setError(true)
      }
    })
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#0f172a] truncate">{co.property_name}</p>
        <p className="text-xs text-[#94a3b8] truncate">
          {co.guest_name}
          {co.guests != null && (
            <span className="ml-1.5">· 👥 {co.guests} huésped{co.guests !== 1 ? 'es' : ''}</span>
          )}
        </p>
        {error && <p className="text-[11px] text-[#ef4444] mt-0.5">⚠️ No se guardó, reintenta</p>}
      </div>

      <div className="flex-shrink-0">
        {editing && canEdit ? (
          <input
            type="time"
            autoFocus
            value={time}
            onChange={e => setTime(e.target.value)}
            onBlur={() => { setEditing(false); save(time) }}
            className="text-sm border border-[#22c55e] rounded-md px-1.5 py-0.5
                       focus:outline-none bg-white w-[100px]"
          />
        ) : (
          <button
            onClick={() => canEdit && setEditing(true)}
            disabled={!canEdit}
            className="flex items-center gap-1 text-sm font-semibold text-[#22c55e]
                       active:opacity-60 transition-opacity disabled:opacity-100"
          >
            {to12h(time)}
            {canEdit && <span className="text-[10px]">✏️</span>}
          </button>
        )}
      </div>
    </div>
  )
}
