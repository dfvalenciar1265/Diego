/**
 * Crear, modificar y cancelar reservas desde el MCP, con las mismas reglas que la app y la
 * sincronización de Gmail: tareas de lib/turnover-tasks.ts, sin dobles reservas en un
 * apartamento, notas que solo se agregan y "borrar" = cancelar (así la sincronización no la
 * vuelve a importar).
 */
import { cleaningTaskFor, missingTurnoverTasks, preparationTaskFor } from '@/lib/turnover-tasks'
import type { ReservationSource, ReservationStatus } from '@/lib/types'
import { shortDate } from './dates'
import type { Db } from './db'

export interface ReservationRow {
  id: string
  property_id: string
  source: ReservationSource
  airbnb_code: string | null
  guest_name: string
  check_in: string
  check_out: string
  guests: number | null
  amount: number
  notes: string | null
  status: ReservationStatus
}

export interface ReservationOut {
  id: string
  airbnb_code: string | null
  source: string
  guest_name: string
  property: string
  check_in: string
  check_out: string
  guests: number | null
  amount: number
  status: string
  notes: string | null
}

type Stay = { check_in: string; check_out: string }

const FIELDS = 'id, property_id, source, airbnb_code, guest_name, check_in, check_out, guests, amount, notes, status'

/** ¿Se cruzan dos estadías? Salir y llegar el mismo día no choca. */
export function staysOverlap(a: Stay, b: Stay): boolean {
  return a.check_in < b.check_out && b.check_in < a.check_out
}

// Notes never carry "|": it separates the "Check-in: … | Check-out: …" times the home and
// cleaning screens read from the reservation.
const clean = (s: string) => s.replace(/\|/g, '/').trim()

/** Agrega una nota al final de las notas de la reserva, sin tocar lo que había. */
export function appendReservationNote(notes: string | null, note: string): string {
  const text = clean(note)
  if (!text) return notes ?? ''
  return notes ? `${notes} | ${text}` : text
}

/** Notas iniciales de una reserva creada desde ChatGPT. */
export function creationNotes(createdBy: string, today: string, note: string): string {
  return appendReservationNote(`Creada desde ChatGPT por ${clean(createdBy)} (${shortDate(today)})`, note)
}

/** `closing` is the last sentence: ChatGPT speaks in first person; the web form passes its own. */
export function conflictMessage(
  property: string,
  conflicts: (Stay & { guest_name: string })[],
  closing = 'No creo ni muevo reservas que se crucen.',
): string {
  const list = conflicts
    .map(c => `${c.guest_name} (${shortDate(c.check_in)} a ${shortDate(c.check_out)})`)
    .join(', ')
  return `${property} ya está ocupado en esas fechas: ${list}. ${closing}`
}

export function toReservationOut(r: ReservationRow, property: string): ReservationOut {
  return {
    id: r.id,
    airbnb_code: r.airbnb_code,
    source: r.source,
    guest_name: r.guest_name,
    property,
    check_in: r.check_in,
    check_out: r.check_out,
    guests: r.guests,
    amount: Number(r.amount ?? 0),
    status: r.status,
    notes: r.notes,
  }
}

export async function findReservationById(db: Db, id: string): Promise<ReservationRow | null> {
  const { data, error } = await db.from('reservations').select(FIELDS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ReservationRow | null) ?? null
}

export async function findReservationByCode(db: Db, code: string): Promise<ReservationRow | null> {
  const { data, error } = await db.from('reservations').select(FIELDS).eq('airbnb_code', code).limit(1)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ReservationRow[])[0] ?? null
}

/** Reservas no canceladas del apartamento que se cruzan con la estadía (sin contar la propia). */
export async function reservationConflicts(
  db: Db,
  propertyId: string,
  stay: Stay,
  excludeId?: string,
): Promise<ReservationRow[]> {
  let query = db.from('reservations').select(FIELDS)
    .eq('property_id', propertyId)
    .neq('status', 'cancelled')
    .lt('check_in', stay.check_out)
    .gt('check_out', stay.check_in)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ReservationRow[]
}

/** Inserta la reserva y sus tareas, como la sincronización (nada para una estadía ya terminada). */
export async function insertReservation(
  db: Db,
  row: Omit<ReservationRow, 'id'>,
  today: string,
): Promise<{ reservation: ReservationRow; tasks_created: number }> {
  const { data, error } = await db.from('reservations').insert(row).select(FIELDS).single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo crear la reserva.')
  const reservation = data as ReservationRow
  const tasks = missingTurnoverTasks([{ ...reservation, tasks: [] }], today)
  if (tasks.length > 0) {
    const { error: taskError } = await db.from('tasks').insert(tasks)
    // The sync's repair step re-creates missing tasks; the reservation itself must not be lost.
    if (taskError) {
      console.error('[gpt-api] no pude crear las tareas de la reserva', reservation.id, taskError.message)
      return { reservation, tasks_created: 0 }
    }
  }
  return { reservation, tasks_created: tasks.length }
}

async function moveTask(db: Db, taskId: string, date: string) {
  const { error } = await db.from('tasks').update({ scheduled_for: date }).eq('id', taskId)
  if (error) throw new Error(error.message)
}

/**
 * Actualiza la reserva y, si cambiaron las fechas, mueve sus tareas como la app: limpieza al día
 * de salida; preparación al día antes de la llegada (nunca al pasado, y no si el huésped ya
 * llegó). Crea las que falten de una estadía vigente confirmada.
 */
export async function updateReservationRow(
  db: Db,
  id: string,
  update: Partial<Omit<ReservationRow, 'id'>>,
  datesChanged: boolean,
  today: string,
): Promise<{ reservation: ReservationRow; tasks_moved: number; tasks_created: number }> {
  const { data, error } = await db.from('reservations').update(update).eq('id', id).select(FIELDS).single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo actualizar la reserva.')
  const reservation = data as ReservationRow
  if (!datesChanged) return { reservation, tasks_moved: 0, tasks_created: 0 }

  const { data: taskRows, error: taskError } = await db.from('tasks').select('id, type').eq('reservation_id', id)
  if (taskError) throw new Error(taskError.message)
  const tasks = (taskRows ?? []) as { id: string; type: string }[]

  let moved = 0
  for (const t of tasks) {
    if (t.type === 'cleaning') {
      await moveTask(db, t.id, cleaningTaskFor(reservation).scheduled_for)
      moved++
    } else if (t.type === 'preparation' && reservation.check_in >= today) {
      await moveTask(db, t.id, preparationTaskFor(reservation, today).scheduled_for)
      moved++
    }
  }

  const missing = reservation.status === 'confirmed'
    ? missingTurnoverTasks([{ ...reservation, tasks }], today)
    : []
  if (missing.length > 0) {
    const { error: insertError } = await db.from('tasks').insert(missing)
    if (insertError) throw new Error(insertError.message)
  }
  return { reservation, tasks_moved: moved, tasks_created: missing.length }
}

/** "Borrar" como la app: la reserva queda cancelada y se borran sus tareas. */
export async function cancelReservationRow(
  db: Db,
  id: string,
): Promise<{ reservation: ReservationRow; tasks_deleted: number }> {
  const { data, error } = await db.from('reservations').update({ status: 'cancelled' }).eq('id', id).select(FIELDS).single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo cancelar la reserva.')
  const { data: deleted, error: deleteError } = await db.from('tasks').delete().eq('reservation_id', id).select('id')
  if (deleteError) throw new Error(deleteError.message)
  return { reservation: data as ReservationRow, tasks_deleted: (deleted ?? []).length }
}
