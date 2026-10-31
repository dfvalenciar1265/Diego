'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveCheckoutCleaning } from '@/actions/checkout-cleaning'
import { canOperateCheckoutCleaning } from '@/lib/checkout-cleaning'
import type { TodayCheckOut } from '@/actions/dashboard'
import type { UserRole } from '@/lib/types'

export interface CleaningPerson { id: string; name: string }
export function CheckoutCleaningControl({ checkout: co, role, memberId, people }: {
  checkout: TodayCheckOut; role: UserRole; memberId: string; people: CleaningPerson[]
}) {
  const task = co.cleaning.task
  const [choosing, setChoosing] = useState(false)
  const [assignee, setAssignee] = useState(task?.assigned_to ?? '')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const manager = role === 'admin' || role === 'anfitrion'
  const permitted = canOperateCheckoutCleaning(role) && (manager || !task?.assigned_to || task.assigned_to === memberId)
  function advance(action: 'start' | 'finish', assignedTo: string) {
    if (!task) return
    setMessage('')
    startTransition(async () => {
      try {
        const result = await saveCheckoutCleaning({ reservation_id: co.id, task_id: task.id, property_id: co.property_id,
          stay_check_in: co.stay.check_in, stay_check_out: co.stay.check_out, action, assigned_to: assignedTo })
        if (!result.success) { setMessage(result.error ?? 'No se guardó la limpieza.'); return }
        setChoosing(false)
        setMessage('Cambio guardado. Actualizando…')
        router.refresh()
      } catch { setMessage('Resultado incierto. Actualiza antes de reintentar; no se ha confirmado en pantalla.') }
    })
  }
  if (!task || co.cleaning.review) return <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
    <p>{co.cleaning.review ?? 'No se pudo comprobar la limpieza.'}</p>
    <Link className="inline-flex min-h-11 items-center underline" href="/cleaning">Revisar en Limpieza</Link>
  </div>
  return <div className="mt-2 border-t border-[#e2e8f0] pt-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className={`font-medium ${task.status === 'done' ? 'text-green-700' : 'text-[#0f172a]'}`}>
          {task.status === 'done' ? '✓ Limpieza terminada' : task.status === 'in_progress' ? '🧹 Limpieza en curso' : '○ Limpieza pendiente'}
        </p>
        <p className="text-[#64748b]">{task.assignee_name ? `A cargo de ${task.assignee_name}` : 'Sin asignar'}</p>
      </div>
      {task.status === 'pending' && permitted && !choosing ? <button disabled={pending} onClick={() => {
        if (manager) setChoosing(true)
        else advance('start', memberId)
      }} className="min-h-11 rounded-lg bg-[#6366f1] px-3 font-semibold text-white disabled:opacity-50">Iniciar limpieza</button> : null}
      {task.status === 'in_progress' && permitted ? <button disabled={pending || !task.assigned_to}
        onClick={() => task.assigned_to && advance('finish', task.assigned_to)}
        className="min-h-11 rounded-lg bg-[#15803d] px-3 font-semibold text-white disabled:opacity-50">Terminar limpieza</button> : null}
    </div>
    {choosing ? <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (assignee) advance('start', assignee) }}>
      <label className="w-full min-w-0 sm:w-auto sm:flex-1">¿Quién va a limpiar?
        <select value={assignee} disabled={pending} onChange={e => setAssignee(e.target.value)}
          className="mt-1 block min-h-11 w-full min-w-0 rounded border bg-white p-2">
          <option value="">Selecciona una persona</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button disabled={pending || !assignee} className="min-h-11 rounded-lg bg-[#6366f1] px-3 font-semibold text-white disabled:opacity-50">Confirmar inicio</button>
      <button type="button" disabled={pending} onClick={() => setChoosing(false)} className="min-h-11 px-1 underline">Cancelar</button>
    </form> : null}
    {!permitted && task.status !== 'done' ? <p className="mt-1 text-[#64748b]">La persona asignada o administración actualiza esta limpieza.</p> : null}
    {message ? <p role="status" className="mt-1 text-[#475569]">{message} <button onClick={() => router.refresh()} className="min-h-11 underline">Actualizar</button></p> : null}
    {task.status === 'done' ? <p className="mt-1 text-[#64748b]">La próxima llegada conserva su revisión y confirmación de listo.</p> : null}
  </div>
}
