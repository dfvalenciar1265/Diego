import type { Db } from './db'
import { isIsoDate, todayInBogota } from './dates'
import { isUuid } from './validate'
import { canOperateCheckoutCleaning, type CheckoutCleaningInput } from '@/lib/checkout-cleaning'
import type { UserRole } from '@/lib/types'

/** Avanza una tarea de salida existente. No crea tareas ni confirma la preparación de otra reserva. */
export async function advanceCheckoutCleaning(db: Db, input: CheckoutCleaningInput,
  actor: { id: string; role: UserRole }, now = new Date()): Promise<{ success: boolean; error?: string }> {
  if (!canOperateCheckoutCleaning(actor.role)) return { success: false, error: 'Tu usuario no puede confirmar esta limpieza.' }
  if (!input || ![input.reservation_id, input.task_id, input.property_id, input.assigned_to].every(isUuid)
    || !['start', 'finish'].includes(input.action) || !isIsoDate(input.stay_check_in) || !isIsoDate(input.stay_check_out)
    || input.stay_check_out <= input.stay_check_in) return { success: false, error: 'Datos de limpieza inválidos.' }
  const conflict = { success: false, error: 'La salida o la limpieza cambió. Actualiza antes de continuar.' }
  const today = todayInBogota(now)
  const { data: stay, error: stayError } = await db.from('reservations')
    .select('id, property_id, check_in, check_out, status').eq('id', input.reservation_id).maybeSingle()
  if (stayError || !stay) return { success: false, error: 'No se pudo comprobar la salida.' }
  if (stay.status !== 'confirmed' || stay.check_in !== input.stay_check_in || stay.check_out !== input.stay_check_out
    || stay.property_id !== input.property_id || stay.check_out !== today) return conflict
  const { data: tasks, error: taskError } = await db.from('tasks')
    .select('id, property_id, reservation_id, type, scheduled_for, status, assigned_to, completed_at')
    .eq('reservation_id', stay.id).eq('type', 'cleaning')
  if (taskError) return { success: false, error: 'No se pudo comprobar la limpieza.' }
  if (tasks?.length !== 1) return { success: false, error: 'Falta una tarea única de limpieza. Revisa en Limpieza; no se eligió ni creó una copia.' }
  const task = { ...tasks[0] }
  if (task.id !== input.task_id || task.property_id !== stay.property_id || task.scheduled_for !== today) return conflict
  const manager = actor.role === 'admin' || actor.role === 'anfitrion'
  if (!manager && (input.assigned_to !== actor.id || (task.assigned_to && task.assigned_to !== actor.id))) {
    return { success: false, error: 'Esta limpieza está a cargo de otra persona. Pide a administración que revise la asignación.' }
  }
  const { data: assignee, error: assigneeError } = await db.from('team_members')
    .select('id, role, active').eq('id', input.assigned_to).maybeSingle()
  if (assigneeError || !assignee?.active || !canOperateCheckoutCleaning(assignee.role)) {
    return { success: false, error: 'Selecciona una persona activa de limpieza, administración o anfitrión.' }
  }
  const nextStatus = input.action === 'start' ? 'in_progress' : 'done'
  // Un reintento nunca reabre ni cambia el responsable/fecha de una limpieza terminada.
  if (task.status === nextStatus && task.assigned_to === input.assigned_to) return { success: true }
  if (input.action === 'start' ? task.status !== 'pending' : task.status !== 'in_progress' || task.assigned_to !== input.assigned_to) return conflict
  const query = db.from('tasks').update({ status: nextStatus, assigned_to: input.assigned_to,
    completed_at: input.action === 'finish' ? now.toISOString() : null })
    .eq('id', task.id).eq('reservation_id', stay.id).eq('property_id', stay.property_id)
    .eq('type', 'cleaning').eq('scheduled_for', today).eq('status', task.status)
  const { data: updated, error } = await (task.assigned_to === null ? query.is('assigned_to', null)
    : query.eq('assigned_to', task.assigned_to)).select('id')
  if (error) return { success: false, error: 'No se guardó la limpieza. Actualiza antes de reintentar.' }
  return updated?.length === 1 ? { success: true } : conflict
}
