/**
 * Foto de la fuente para la disponibilidad pública, leída de Supabase en el servidor (cliente de
 * servicio, solo SELECT de columnas puntuales). Nunca escribe.
 *
 * Qué certifica cada cosa:
 * - `calendar_sync_runs`: la última corrida COMPLETA y VERIFICADA del sincronizador iCal
 *   (lib/calendar-sync). Es lo único que da lastSyncedAt (su data_as_of) y coverage.
 *   La importación de correos de Gmail NO cuenta.
 * - `calendar_events`: lo que publica el calendario de Airbnb de cada anuncio (reservas y noches
 *   bloqueadas, que incluyen las reservas directas bloqueadas en Airbnb). Es la autoridad para todo
 *   lo de Airbnb: cancelaciones y cambios de fechas ya vienen reflejados.
 * - `reservations`: solo las cargadas a mano como reserva directa o bloqueo (source 'direct' o
 *   status 'blocked'), por si alguna no se bloqueó en Airbnb. Las de Airbnb importadas por correo
 *   no se usan: el calendario manda (una cancelación que el correo no trajo no ocupa).
 * - `availability_rules`: reglas por apartamento; solo cuentan las que tienen `verified_at`.
 * - `properties`: capacidad y estado en AirAdmin, para detectar conflictos con el catálogo fijo.
 */
import { parseClockTime } from '@/lib/gpt-api/turnovers'
import { CASA_BLUE_CATALOG } from './catalog'
import type { BusyPeriod, SourceSnapshot, UnitRules, UnitSnapshot } from './compute'
import type { AvailabilityQuery } from './query'
import type { DateOverrideRow } from './rules-input'

export const CALENDAR_SOURCE = 'airbnb-ical'

// Cliente mínimo que usamos: así las pruebas pasan un doble sin red.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadDb = { rpc: (fn: string, args: Record<string, unknown>) => any }

interface QueryError { code?: string; message?: string }

const isMissingTable = (e: QueryError | null) => !!e && ['42P01', 'PGRST205', '42703', '42883', 'PGRST202'].includes(e.code ?? '')

class SourceError extends Error {
  constructor(readonly status: 'unconfigured' | 'unavailable', reason: string) {
    super(reason)
  }
}

function check<T>(res: { data: T | null; error: QueryError | null }, what: string): T {
  if (isMissingTable(res.error)) throw new SourceError('unconfigured', `${what}: tabla o columna no creada`)
  if (res.error) throw new SourceError('unavailable', `${what}: ${res.error.code ?? 'error'}`)
  return (res.data ?? ([] as unknown)) as T
}

interface SyncRunRow { data_as_of: string; coverage_from: string | null; coverage_to: string | null; property_ids: string[] | null }
interface PropertyRow { id: string; capacity: number | null; active: boolean | null }
interface RulesDbRow {
  property_id: string
  min_nights: number
  max_nights: number | null
  date_overrides: DateOverrideRow[] | null
  advance_notice_hours: number
  booking_window_days: number | null
  preparation_nights: number
  same_day_turnover: boolean
  turnover_hours: number | string | null
  check_in_days: number[] | null
  check_out_days: number[] | null
  check_in_time: string | null
  check_out_time: string | null
}
interface EventRow { property_id: string; start_date: string; end_date: string }
interface SnapshotRows {
  run: SyncRunRow | null
  consistent: boolean
  properties: PropertyRow[]
  rules: RulesDbRow[]
  events: EventRow[]
  manual: ReservationRow[]
}
interface ReservationRow {
  id: string
  property_id: string
  check_in: string
  check_out: string
  notes: string | null
  pending_change: { check_in_to?: string | null; check_out_to?: string | null } | null
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

export function toRules(r: RulesDbRow): UnitRules {
  return {
    minNights: r.min_nights,
    maxNights: r.max_nights,
    dateOverrides: (r.date_overrides ?? []).map(o => ({
      from: o.from,
      to: o.to,
      ...(o.min_nights !== undefined && { minNights: o.min_nights }),
      ...(o.max_nights !== undefined && { maxNights: o.max_nights }),
      ...(o.advance_notice_hours !== undefined && { advanceNoticeHours: o.advance_notice_hours }),
      ...(o.check_in_days !== undefined && { checkInDays: o.check_in_days }),
      ...(o.check_out_days !== undefined && { checkOutDays: o.check_out_days }),
    })),
    advanceNoticeHours: r.advance_notice_hours,
    bookingWindowDays: r.booking_window_days,
    preparationNights: r.preparation_nights,
    sameDayTurnover: r.same_day_turnover,
    turnoverHours: r.turnover_hours == null ? null : Number(r.turnover_hours),
    checkInDays: r.check_in_days,
    checkOutDays: r.check_out_days,
    checkInTime: hhmm(r.check_in_time),
    checkOutTime: hhmm(r.check_out_time),
  }
}

/** Hora que quedó en las notas ("Check-out: 11:00 AM"); solo la hora sale de aquí. */
function noteTime(notes: string | null, field: 'Check-in' | 'Check-out'): string | null {
  const raw = notes?.match(new RegExp(`${field}:\\s*([^|]+)`, 'i'))?.[1]?.trim()
  return raw ? parseClockTime(raw) : null
}

/** Marcas de la app que dicen que las fechas de la reserva pueden no ser las reales. */
const UNCERTAIN_MARKS = ['⚠️ Fechas actualizadas', '⚠️ Diferencia con Airbnb']

export function toPeriod(r: ReservationRow): BusyPeriod {
  const p = r.pending_change
  const changesDates = !!p && ((p.check_in_to && p.check_in_to !== r.check_in) || (p.check_out_to && p.check_out_to !== r.check_out))
  return {
    start: r.check_in,
    end: r.check_out,
    startTime: noteTime(r.notes, 'Check-in'),
    endTime: noteTime(r.notes, 'Check-out'),
    datesUncertain: UNCERTAIN_MARKS.some(m => r.notes?.includes(m)),
    alternate: changesDates ? { start: p!.check_in_to ?? r.check_in, end: p!.check_out_to ?? r.check_out } : null,
  }
}

export async function loadSnapshot(db: ReadDb, query: AvailabilityQuery, signal?: AbortSignal): Promise<SourceSnapshot> {
  const withSignal = <Q extends { abortSignal?: (s: AbortSignal) => Q }>(q: Q): Q => (signal && q.abortSignal ? q.abortSignal(signal) : q)

  try {
    // One STABLE SQL statement: metadata, events and manual changes share a DB snapshot.
    // It also avoids PostgREST's row limit truncating a busy calendar into false free nights.
    const rows = check<SnapshotRows>(await withSignal(db.rpc('read_casa_blue_availability', {
      p_arrival: query.arrival, p_departure: query.departure,
    })), 'read_casa_blue_availability')
    const run = rows?.run
    if (!run) return { kind: 'problem', status: 'unconfigured', reason: 'no hay sincronización de calendario verificada' }
    if (rows.consistent !== true) return { kind: 'problem', status: 'incomplete', reason: 'eventos y corrida no corresponden' }
    const { properties, rules, events, manual } = rows

    const synced = new Set(run.property_ids ?? [])
    const coverage = run.coverage_from && run.coverage_to ? { from: run.coverage_from, to: run.coverage_to } : null

    const periodsByProperty = new Map<string, BusyPeriod[]>()
    const add = (propertyId: string, p: BusyPeriod) => periodsByProperty.set(propertyId, [...(periodsByProperty.get(propertyId) ?? []), p])
    for (const e of events) add(e.property_id, { start: e.start_date, end: e.end_date })
    for (const r of manual) add(r.property_id, toPeriod(r))

    const propById = new Map(properties.map(p => [p.id, p]))
    const rulesById = new Map(rules.map(r => [r.property_id, r]))

    const units: UnitSnapshot[] = CASA_BLUE_CATALOG.map(c => {
      const prop = propById.get(c.propertyId)
      const conflicts: string[] = []
      if (!prop) conflicts.push('no existe en AirAdmin')
      else {
        if (prop.active === false) conflicts.push('inactivo en AirAdmin')
        if (query.guests !== undefined && prop.capacity !== c.capacity) conflicts.push(`capacidad ${prop.capacity} en AirAdmin vs ${c.capacity} en el catálogo`)
      }
      if (!synced.has(c.propertyId)) conflicts.push('fuera de la última sincronización verificada')
      const r = rulesById.get(c.propertyId)
      return {
        slug: c.slug,
        capacity: c.capacity,
        conflicts,
        rules: r ? toRules(r) : null,
        periods: periodsByProperty.get(c.propertyId) ?? [],
      }
    })

    return { kind: 'data', lastSyncedAt: run.data_as_of, coverage, units }
  } catch (err) {
    if (err instanceof SourceError) return { kind: 'problem', status: err.status, reason: err.message }
    return { kind: 'problem', status: 'unavailable', reason: err instanceof Error ? err.name : 'error' }
  }
}
