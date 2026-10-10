/**
 * Validación de lo que manda ChatGPT. Los errores van en español: el GPT se los explica a Diego.
 */
import type { MaintenancePriority, MaintenanceStatus } from '@/lib/types'
import { isIsoDate, addDays, daysBetween } from './dates'
import { parseClockTime } from './turnovers'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
type Failure = { ok: false; error: string }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = (error: string): Failure => ({ ok: false, error })

export const LIMITS = {
  rangeDays: 120,
  defaultRangeDays: 60,
  reservations: 300,
  title: 120,
  text: 1000,
  name: 100,
  property: 200,
  code: 20,
  guests: 50,
  turnoverDays: 30,
} as const

const PRIORITIES = ['urgent', 'normal', 'scheduled'] as const
const STATUSES = ['open', 'in_progress', 'resolved'] as const
const FILTERS = ['active', ...STATUSES] as const

export interface Range {
  from: string
  to: string
}

/** Una reserva tal como la leyó ChatGPT en Airbnb. */
export interface AirbnbReservationInput {
  code: string | null
  guest_name: string
  property: string
  check_in: string
  check_out: string
  guests: number | null
  status: 'confirmed' | 'cancelled'
}

export interface CompareInput extends Range {
  dry_run: boolean
  reservations: AirbnbReservationInput[]
}

export interface NewMaintenanceInput {
  property: string
  title: string
  description: string
  priority: MaintenancePriority
}

export interface MaintenancePatch {
  status?: MaintenanceStatus
  note?: string
  cost?: number
}

/** Cambio de hora de salida o de llegada de un apartamento en un día. */
export interface TimeChangeInput {
  property: string
  time: string          // "HH:MM"
  date: string          // YYYY-MM-DD
  guest_name: string | null
}

/** `active` = abiertos + en progreso. */
export type MaintenanceFilter = MaintenanceStatus | 'active'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

function text(v: unknown, field: string, max: number, required: boolean): Parsed<string> {
  if (v === undefined || v === null || v === '') return required ? fail(`Falta "${field}".`) : ok('')
  if (typeof v !== 'string') return fail(`"${field}" debe ser texto.`)
  const s = v.trim()
  if (required && !s) return fail(`Falta "${field}".`)
  if (s.length > max) return fail(`"${field}" es muy largo (máximo ${max} caracteres).`)
  return ok(s)
}

function checkRange(from: string, to: string): Parsed<Range> {
  if (to < from) return fail('"to" no puede ser anterior a "from".')
  if (daysBetween(from, to) > LIMITS.rangeDays) return fail(`El rango máximo es de ${LIMITS.rangeDays} días.`)
  return ok({ from, to })
}

export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/** Rango de GET /reservations: por defecto, de hoy a 60 días. */
export function parseRange(from: string | null, to: string | null, today: string): Parsed<Range> {
  const f = from || today
  if (!isIsoDate(f)) return fail('"from" debe ser una fecha AAAA-MM-DD.')
  const t = to || addDays(f, LIMITS.defaultRangeDays)
  if (!isIsoDate(t)) return fail('"to" debe ser una fecha AAAA-MM-DD.')
  return checkRange(f, t)
}

export function parseCompareBody(body: unknown): Parsed<CompareInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const { from, to, dry_run: dryRun, reservations: list } = body
  if (!isIsoDate(from)) return fail('"from" debe ser una fecha AAAA-MM-DD.')
  if (!isIsoDate(to)) return fail('"to" debe ser una fecha AAAA-MM-DD.')
  const range = checkRange(from, to)
  if (!range.ok) return range
  if (dryRun !== undefined && typeof dryRun !== 'boolean') return fail('"dry_run" debe ser true o false.')
  if (!Array.isArray(list)) return fail('"reservations" debe ser una lista.')
  if (list.length === 0) return fail('La lista de Airbnb llegó vacía; no comparo para no marcar todo como faltante.')
  if (list.length > LIMITS.reservations) return fail(`Máximo ${LIMITS.reservations} reservas por envío.`)

  const reservations: AirbnbReservationInput[] = []
  for (const [i, raw] of list.entries()) {
    const parsed = parseAirbnbReservation(raw)
    if (!parsed.ok) return fail(`Reserva #${i + 1}: ${parsed.error}`)
    reservations.push(parsed.value)
  }
  return ok({ ...range.value, dry_run: dryRun === true, reservations })
}

function parseAirbnbReservation(raw: unknown): Parsed<AirbnbReservationInput> {
  if (!isRecord(raw)) return fail('debe ser un objeto.')
  const code = text(raw.code, 'code', LIMITS.code, false)
  if (!code.ok) return code
  const guest = text(raw.guest_name, 'guest_name', LIMITS.name, true)
  if (!guest.ok) return guest
  const property = text(raw.property, 'property', LIMITS.property, true)
  if (!property.ok) return property

  const checkIn = raw.check_in
  const checkOut = raw.check_out
  if (!isIsoDate(checkIn)) return fail('"check_in" debe ser una fecha AAAA-MM-DD.')
  if (!isIsoDate(checkOut)) return fail('"check_out" debe ser una fecha AAAA-MM-DD.')
  if (checkOut <= checkIn) return fail('"check_out" debe ser posterior a "check_in".')

  let guests: number | null = null
  if (raw.guests !== undefined && raw.guests !== null) {
    const g = raw.guests
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 1 || g > LIMITS.guests) {
      return fail(`"guests" debe ser un entero entre 1 y ${LIMITS.guests}.`)
    }
    guests = g
  }

  const status = raw.status ?? 'confirmed'
  if (!oneOf(status, ['confirmed', 'cancelled'] as const)) return fail('"status" debe ser "confirmed" o "cancelled".')

  return ok({
    code: code.value ? code.value.replace(/\s+/g, '').toUpperCase() : null,
    guest_name: guest.value,
    property: property.value,
    check_in: checkIn,
    check_out: checkOut,
    guests,
    status,
  })
}

export function parseNewMaintenance(body: unknown): Parsed<NewMaintenanceInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const property = text(body.property, 'property', LIMITS.name, true)
  if (!property.ok) return property
  const title = text(body.title, 'title', LIMITS.title, true)
  if (!title.ok) return title
  const description = text(body.description, 'description', LIMITS.text, false)
  if (!description.ok) return description
  const priority = body.priority
  if (!oneOf(priority, PRIORITIES)) return fail('"priority" debe ser "urgent", "normal" o "scheduled".')
  return ok({ property: property.value, title: title.value, description: description.value, priority })
}

export function parseMaintenancePatch(body: unknown): Parsed<MaintenancePatch> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const patch: MaintenancePatch = {}
  const status = body.status
  if (status !== undefined) {
    if (!oneOf(status, STATUSES)) return fail('"status" debe ser "open", "in_progress" o "resolved".')
    patch.status = status
  }
  if (body.note !== undefined) {
    const note = text(body.note, 'note', LIMITS.text, true)
    if (!note.ok) return note
    patch.note = note.value
  }
  if (body.cost !== undefined) {
    const cost = body.cost
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
      return fail('"cost" debe ser un número mayor o igual a 0.')
    }
    patch.cost = cost
  }
  if (Object.keys(patch).length === 0) return fail('Envía al menos "status", "note" o "cost".')
  return ok(patch)
}

export function parseMaintenanceFilter(status: string | null): Parsed<MaintenanceFilter> {
  if (!status) return ok('active')
  if (!oneOf(status, FILTERS)) return fail('"status" debe ser "active", "open", "in_progress" o "resolved".')
  return ok(status)
}

/** Día de las salidas/llegadas: por defecto hoy; de hoy a 30 días adelante. */
export function parseTurnoverDate(date: string | null | undefined, today: string): Parsed<string> {
  const d = date || today
  if (!isIsoDate(d)) return fail('"date" debe ser una fecha AAAA-MM-DD.')
  if (d < today) return fail('Solo se pueden ver o cambiar horas de hoy en adelante.')
  if (daysBetween(today, d) > LIMITS.turnoverDays) return fail(`Solo hasta ${LIMITS.turnoverDays} días adelante.`)
  return ok(d)
}

export function parseTimeChange(body: unknown, today: string): Parsed<TimeChangeInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const property = text(body.property, 'property', LIMITS.name, true)
  if (!property.ok) return property
  const rawTime = text(body.time, 'time', 20, true)
  if (!rawTime.ok) return rawTime
  const time = parseClockTime(rawTime.value)
  if (!time) return fail('"time" debe ser una hora como 10am, 3:30 pm o 15:30.')
  const rawDate = body.date
  if (rawDate !== undefined && rawDate !== null && typeof rawDate !== 'string') {
    return fail('"date" debe ser una fecha AAAA-MM-DD.')
  }
  const date = parseTurnoverDate(rawDate, today)
  if (!date.ok) return date
  const guest = text(body.guest_name, 'guest_name', LIMITS.name, false)
  if (!guest.ok) return guest
  return ok({ property: property.value, time, date: date.value, guest_name: guest.value || null })
}
