'use client'
import { useState, useTransition } from 'react'
import { updateTaskNotes } from '@/actions/tasks'
import { NotifyBuildingButton } from './NotifyBuildingButton'
import { ReservationTimePanel } from './ReservationTimePanel'
import { ArrivalPreparationPanel } from './ArrivalPreparationPanel'
import { annotationNote, resolveReservationTiming } from '@/lib/reservation-times'
import { addDays } from '@/lib/gpt-api/dates'
import type { PreparationArrival, PreparationView } from '@/lib/preparation'
import type { UserRole } from '@/lib/types'

export function DashboardPrepCard({ arrival: r, preparation, role }: {
  arrival: PreparationArrival; preparation: PreparationView; role: UserRole
}) {
  const tasks = r.tasks.filter(t => t.type === 'preparation')
  const currentTasks = tasks.filter(t => t.property_id === r.property_id && t.scheduled_for >= addDays(r.check_in, -1) && t.scheduled_for <= r.check_in)
  const task = tasks.length === 1 && currentTasks.length === 1 ? currentTasks[0] : null
  const [note, setNote] = useState(annotationNote(task?.notes))
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const timing = resolveReservationTiming(r, 'checkin', task ?? undefined)
  const ready = preparation.available && Boolean(preparation.state?.ready_at) && preparation.blockers.length === 0
  const heading = <>
    <p className="text-sm font-semibold text-[#0f172a]">{ready ? '✅' : '🛏️'} {r.property?.name ?? '—'}</p>
    <p className="text-xs text-[#64748b]">{r.guest_name || '—'} · <span className={`font-semibold text-[#0f172a] ${r.guests == null ? '' : 'whitespace-nowrap'}`}>
      {r.guests == null ? 'Huéspedes por confirmar' : `${r.guests} huésped${r.guests === 1 ? '' : 'es'}`}
    </span></p>
    <p className="text-xs text-[#64748b]">Llega el {new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota', day: 'numeric', month: 'short',
    }).format(new Date(`${r.check_in}T12:00:00-05:00`))}</p>
  </>
  function saveNote() {
    if (!task) return
    startTransition(async () => {
      try {
        const result = await updateTaskNotes(task.id, note, { noteOnly: true })
        setError(result.success ? '' : result.error ?? 'No se guardó la nota.')
      } catch { setError('No se guardó la nota. Revisa tu conexión.') }
    })
  }
  return <div className="rounded-xl border bg-white px-3 py-2.5 shadow-sm">
    <ReservationTimePanel key={timing.version} timing={timing} stay={r} canEdit={role === 'admin'} heading={heading} />
    <ArrivalPreparationPanel key={preparation.state?.version ?? 0} reservation={r} preparation={preparation} role={role} />
    {task ? <label className="mt-1 block text-xs">Nota para el equipo
      <textarea rows={1} value={note} disabled={pending} onChange={e => setNote(e.target.value)} onBlur={saveNote}
        placeholder="Indicaciones para esta llegada" className="mt-1 min-h-11 w-full rounded border p-2" />
    </label> : <div className="mt-2 text-xs text-amber-900">
      <p>{tasks.length > 1 ? 'Hay varias tareas de preparación. Revisa sus notas antes de editar; ninguna se fusionó ni borró.'
        : tasks.length ? 'La tarea corresponde a otra fecha o apartamento; revisa antes de editar.' : 'Falta la tarea de preparación. No se ha creado automáticamente.'}</p>
      {tasks.length > 0 ? <details>
        <summary className="min-h-11 cursor-pointer py-3">Ver notas de las tareas ({tasks.length})</summary>
        {tasks.map(t => <p key={t.id} className="mb-1 break-words">{t.scheduled_for} · {annotationNote(t.notes) || 'Sin nota adicional'}</p>)}
      </details> : null}
    </div>}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    {task ? <NotifyBuildingButton taskId={task.id} notifiedAt={task.building_notified_at ?? null} data={{
      apartment: r.property?.name ?? '—', guestName: r.guest_name || '—', checkIn: r.check_in,
      checkOut: r.check_out, guests: r.guests,
    }} /> : null}
  </div>
}
