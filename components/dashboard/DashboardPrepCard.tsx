'use client'
import { useState, useTransition } from 'react'
import { updateTaskNotes } from '@/actions/tasks'
import { NotifyBuildingButton } from './NotifyBuildingButton'
import { ReservationTimePanel } from './ReservationTimePanel'
import { annotationNote, resolveReservationTiming, type TimeEvent } from '@/lib/reservation-times'
import type { Task } from '@/lib/types'

export type PrepTask = Task & {
  property?: { name: string }
  reservation?: {
    id: string; property_id: string; status: string; time_version?: number; time_events: TimeEvent[]
    check_in: string; check_out: string; notes: string | null; guest_name: string | null; guests: number | null
  } | null
}
export function DashboardPrepCard({ task, canEdit = false }: { task: PrepTask; canEdit?: boolean }) {
  const r = task.reservation
  const [note, setNote] = useState(annotationNote(task.notes))
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const timing = r ? resolveReservationTiming(r, 'checkin', task) : null
  const heading = <>
    <p className="text-sm font-semibold text-[#0f172a]">{task.status === 'done' ? '✅' : '🛏️'} {task.property?.name ?? '—'}</p>
    <p className="text-xs text-[#64748b]">{r?.guest_name ?? '—'} · <span className="font-semibold text-[#0f172a]">
      {r?.guests == null ? 'Huéspedes por confirmar' : `${r.guests} huésped${r.guests === 1 ? '' : 'es'}`}
    </span></p>
    {r ? <p className="text-xs text-[#64748b]">Llega el {new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota', day: 'numeric', month: 'short',
    }).format(new Date(`${r.check_in}T12:00:00-05:00`))}</p> : null}
  </>
  function saveNote() {
    startTransition(async () => {
      try {
        // La acción conserva la hora vigente; editar una nota nunca autoriza una excepción.
        const result = await updateTaskNotes(task.id, note, { noteOnly: true })
        setError(result.success ? '' : result.error ?? 'No se guardó la nota.')
      } catch { setError('No se guardó la nota. Revisa tu conexión.') }
    })
  }
  return <div className="rounded-xl border bg-white px-3 py-2.5 shadow-sm">
    {timing && r ? <ReservationTimePanel key={timing.version} timing={timing} stay={r} canEdit={canEdit} heading={heading} /> : heading}
    <label className="mt-1 block text-xs">Nota para el equipo
      <textarea rows={1} value={note} disabled={pending} onChange={e => setNote(e.target.value)} onBlur={saveNote}
        placeholder="Indicaciones para esta llegada" className="mt-1 min-h-11 w-full rounded border p-2" />
    </label>
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    {r ? <NotifyBuildingButton taskId={task.id} notifiedAt={task.building_notified_at ?? null} data={{
      apartment: task.property?.name ?? '—', guestName: r.guest_name ?? '—', checkIn: r.check_in,
      checkOut: r.check_out, guests: r.guests,
    }} /> : null}
  </div>
}
