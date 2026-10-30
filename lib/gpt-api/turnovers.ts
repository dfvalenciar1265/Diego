/**
 * Horas de salida (check-out) y de llegada para la preparación (check-in), como las muestran
 * "Salidas de hoy" y "Preparación hoy" en la portada. La hora editada vive en la tarea del día:
 * limpieza → "HH:MM|", preparación → "HH:MM|nota". Sin hora editada, la salida es la estándar
 * (11:00, lib/checkout.ts) y la llegada es a las 15:00; las ETA y los correos se muestran por separado.
 */
import { resolveReservationTiming, annotationNote, type TimeEvent, type ReservationTiming } from '@/lib/reservation-times'
import { addDays } from './dates'
export { parseClockTime } from '@/lib/clock-time'
import type { Db } from './db'

export interface TurnoverTask {
  id: string
  type: string
  scheduled_for: string
  notes: string | null
  status: string
}

export interface TurnoverReservation {
  id: string
  airbnb_code: string | null
  guest_name: string
  guests: number | null
  property_id: string
  check_in: string
  check_out: string
  notes: string | null
  tasks: TurnoverTask[] | null
  time_version?: number
  time_events?: TimeEvent[] | null
  status?: string
}

/**
 * app = excepción autorizada; default = estándar (salida 11:00, llegada 15:00).
 * reservation se conserva en el tipo por compatibilidad; un correo no cambia la hora permitida.
 */
export type TimeSource = 'app' | 'reservation' | 'default'

export interface CheckoutSlot {
  property: string
  guest_name: string
  airbnb_code: string | null
  time: string
  time_source: TimeSource
  timing: ReservationTiming
  cleaning_task_id: string | null
}

export interface CheckinSlot {
  property: string
  guest_name: string
  airbnb_code: string | null
  guests: number | null
  time: string
  time_source: TimeSource
  timing: ReservationTiming
  note: string
  preparation_task_id: string | null
  preparation_status: string | null
}

/** Notas de la tarea de limpieza con la hora de salida: solo la hora, como el lápiz de "Salidas de hoy". */
export function withCheckoutTime(time: string): string {
  return `${time}|`
}

/** Notas de la tarea de preparación con la hora de llegada, conservando la nota (lápiz de "Preparación hoy"). */
export function withCheckinTime(notes: string | null, time: string): string {
  return `${time}|${annotationNote(notes)}`
}

export function checkoutSlot(r: TurnoverReservation, date: string, property: string): CheckoutSlot {
  const task = r.tasks?.find(t => t.type === 'cleaning' && t.scheduled_for === date && date === r.check_out) ?? null
  const timing = resolveReservationTiming(r, 'checkout', task ?? undefined)
  return {
    property,
    guest_name: r.guest_name,
    airbnb_code: r.airbnb_code,
    time: timing.effective_time,
    time_source: timing.authorization ? 'app' : 'default',
    timing,
    cleaning_task_id: task?.id ?? null,
  }
}

export function checkinSlot(r: TurnoverReservation, property: string): CheckinSlot {
  const task = r.tasks?.find(t => t.type === 'preparation' && t.scheduled_for >= addDays(r.check_in, -1) && t.scheduled_for <= r.check_in) ?? null
  const timing = resolveReservationTiming(r, 'checkin', task ?? undefined)
  return {
    property,
    guest_name: r.guest_name,
    airbnb_code: r.airbnb_code,
    guests: r.guests,
    time: timing.effective_time,
    time_source: timing.authorization ? 'app' : 'default',
    timing,
    note: annotationNote(task?.notes),
    preparation_task_id: task?.id ?? null,
    preparation_status: task?.status ?? null,
  }
}

const FIELDS = 'time_version, time_events:reservation_time_events(*), status, id, airbnb_code, guest_name, guests, notes, property_id, check_in, check_out, tasks(id, type, scheduled_for, notes, status)'

/** Reservas (no canceladas) que salen o llegan ese día, con sus tareas. */
export async function reservationsTurningOver(
  db: Db,
  kind: 'checkout' | 'checkin',
  date: string,
  propertyId?: string,
): Promise<TurnoverReservation[]> {
  let query = db.from('reservations').select(FIELDS)
    .eq(kind === 'checkout' ? 'check_out' : 'check_in', date)
    .neq('status', 'cancelled')
    .order('guest_name')
  if (propertyId) query = query.eq('property_id', propertyId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as TurnoverReservation[]
}

export async function turnoverReservationById(db: Db, id: string): Promise<TurnoverReservation | null> {
  const { data, error } = await db.from('reservations').select(FIELDS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as TurnoverReservation | null
}
