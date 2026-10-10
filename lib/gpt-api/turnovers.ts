/**
 * Horas de salida (check-out) y de llegada para la preparación (check-in), como las muestran
 * "Salidas de hoy" y "Preparación hoy" en la portada. La hora editada vive en la tarea del día:
 * limpieza → "HH:MM|", preparación → "HH:MM|nota". Sin hora editada vale la que quedó en la
 * reserva desde el correo de Airbnb ("Check-out: 11:00 AM") o la de siempre (12:00 / 15:00).
 */
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
}

/** app = la fijó alguien en la app; reservation = la de la reserva (correo de Airbnb); default = la de siempre. */
export type TimeSource = 'app' | 'reservation' | 'default'

export interface CheckoutSlot {
  property: string
  guest_name: string
  airbnb_code: string | null
  time: string
  time_source: TimeSource
  cleaning_task_id: string | null
}

export interface CheckinSlot {
  property: string
  guest_name: string
  airbnb_code: string | null
  guests: number | null
  time: string
  time_source: TimeSource
  note: string
  preparation_task_id: string | null
  preparation_status: string | null
}

const DEFAULT_CHECKOUT = '12:00'
const DEFAULT_CHECKIN = '15:00'
const TIME_PREFIX = /^(\d{2}:\d{2})\|/

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** "10am", "3:30 pm", "12 p.m.", "15:30" → "HH:MM"; null si no es una hora válida. */
export function parseClockTime(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/)
  if (ampm) {
    let h = Number(ampm[1])
    const m = ampm[2] ? Number(ampm[2]) : 0
    if (h < 1 || h > 12 || m > 59) return null
    if (ampm[3] === 'p' && h !== 12) h += 12
    if (ampm[3] === 'a' && h === 12) h = 0
    return hhmm(h, m)
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const h = Number(h24[1])
    const m = Number(h24[2])
    return h <= 23 && m <= 59 ? hhmm(h, m) : null
  }
  return null
}

/** Hora guardada en las notas de una tarea ("HH:MM|…"), o null. */
function taskTime(notes: string | null): string | null {
  return notes?.match(TIME_PREFIX)?.[1] ?? null
}

/** Hora que quedó en la reserva desde el correo ("Check-out: 11:00 AM | …"), o null. */
function reservationTime(notes: string | null, field: 'Check-in' | 'Check-out'): string | null {
  const raw = notes?.match(new RegExp(`${field}:\\s*([^|]+)`, 'i'))?.[1]?.trim()
  return raw ? parseClockTime(raw) : null
}

/** Nota de la tarea de preparación sin la hora; la automática ("Preparación para…") no cuenta. */
function preparationNote(notes: string | null): string {
  if (!notes) return ''
  const m = notes.match(/^(\d{2}:\d{2})\|(.*)$/s)
  if (m) return m[2]
  return notes.startsWith('Preparación para') ? '' : notes
}

/** Notas de la tarea de limpieza con la hora de salida: solo la hora, como el lápiz de "Salidas de hoy". */
export function withCheckoutTime(time: string): string {
  return `${time}|`
}

/** Notas de la tarea de preparación con la hora de llegada, conservando la nota (lápiz de "Preparación hoy"). */
export function withCheckinTime(notes: string | null, time: string): string {
  return `${time}|${preparationNote(notes)}`
}

export function checkoutSlot(r: TurnoverReservation, date: string, property: string): CheckoutSlot {
  const task = r.tasks?.find(t => t.type === 'cleaning' && t.scheduled_for === date) ?? null
  const fromApp = taskTime(task?.notes ?? null)
  const fromReservation = reservationTime(r.notes, 'Check-out')
  return {
    property,
    guest_name: r.guest_name,
    airbnb_code: r.airbnb_code,
    time: fromApp ?? fromReservation ?? DEFAULT_CHECKOUT,
    time_source: fromApp ? 'app' : fromReservation ? 'reservation' : 'default',
    cleaning_task_id: task?.id ?? null,
  }
}

export function checkinSlot(r: TurnoverReservation, property: string): CheckinSlot {
  const task = r.tasks?.find(t => t.type === 'preparation') ?? null
  const fromApp = taskTime(task?.notes ?? null)
  const fromReservation = reservationTime(r.notes, 'Check-in')
  return {
    property,
    guest_name: r.guest_name,
    airbnb_code: r.airbnb_code,
    guests: r.guests,
    time: fromApp ?? fromReservation ?? DEFAULT_CHECKIN,
    time_source: fromApp ? 'app' : fromReservation ? 'reservation' : 'default',
    note: preparationNote(task?.notes ?? null),
    preparation_task_id: task?.id ?? null,
    preparation_status: task?.status ?? null,
  }
}

const FIELDS = 'id, airbnb_code, guest_name, guests, notes, property_id, check_in, check_out, tasks(id, type, scheduled_for, notes, status)'

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

export async function setTaskNotes(db: Db, taskId: string, notes: string): Promise<void> {
  const { error } = await db.from('tasks').update({ notes }).eq('id', taskId)
  if (error) throw new Error(error.message)
}
