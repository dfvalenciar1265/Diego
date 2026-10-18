/**
 * Foto de la fuente para la disponibilidad pública, leída de Supabase en el servidor (cliente de
 * servicio, solo SELECT de columnas puntuales). Nunca escribe.
 *
 * Qué certifica cada cosa:
 * - `calendar_sync_runs`: la última corrida COMPLETA y VERIFICADA de un sincronizador de calendario
 *   que deja en `reservations` todo lo que ocupa los ocho apartamentos (reservas, bloqueos/reservas
 *   directas, cambios y cancelaciones) dentro de su cobertura. Es lo único que da lastSyncedAt y
 *   coverage. La importación de correos de Gmail NO cuenta: no trae los bloqueos del calendario de
 *   Airbnb ni las reglas, así que no demuestra que no falte nada.
 * - `availability_rules`: reglas por apartamento, solo cuentan las que tienen `verified_at`.
 * - `properties`: capacidad y estado en AirAdmin, para detectar conflictos con el catálogo fijo.
 */
import { parseClockTime } from '@/lib/gpt-api/turnovers'
import { addDays, todayInBogota } from '@/lib/gpt-api/dates'
import { CASA_BLUE_CATALOG, CATALOG_PROPERTY_IDS } from './catalog'
import type { BusyPeriod, SourceSnapshot, UnitRules, UnitSnapshot } from './compute'
import type { AvailabilityQuery } from './query'

/** Margen alrededor de la estadía para ver vecinos que afectan la preparación (máx. 7 noches en la tabla). */
const NEIGHBOR_MARGIN_DAYS = 8

// Cliente mínimo que usamos: así las pruebas pasan un doble sin red.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadDb = { from: (table: string) => any }

interface QueryError { code?: string; message?: string }

const isMissingTable = (e: QueryError | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')

class SourceError extends Error {
  constructor(readonly status: 'unconfigured' | 'unavailable', reason: string) {
    super(reason)
  }
}

function check<T>(res: { data: T | null; error: QueryError | null }, what: string): T {
  if (isMissingTable(res.error)) throw new SourceError('unconfigured', `${what}: tabla no creada`)
  if (res.error) throw new SourceError('unavailable', `${what}: ${res.error.code ?? 'error'}`)
  return (res.data ?? ([] as unknown)) as T
}

interface SyncRunRow { completed_at: string; coverage_from: string | null; coverage_to: string | null; property_ids: string[] | null }
interface PropertyRow { id: string; capacity: number | null; active: boolean | null }
interface RulesRow {
  property_id: string
  min_nights: number
  max_nights: number | null
  min_nights_overrides: Array<{ from: string; to: string; min_nights: number }> | null
  advance_notice_hours: number
  booking_window_days: number | null
  preparation_nights: number
  same_day_turnover: boolean
  turnover_hours: number | null
  check_in_days: number[] | null
  check_out_days: number[] | null
  check_in_time: string | null
  check_out_time: string | null
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

function toRules(r: RulesRow): UnitRules {
  return {
    minNights: r.min_nights,
    maxNights: r.max_nights,
    minNightsOverrides: (r.min_nights_overrides ?? []).map(o => ({ from: o.from, to: o.to, minNights: o.min_nights })),
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

/** Hora que quedó en las notas desde el correo ("Check-out: 11:00 AM"); solo la hora sale de aquí. */
function noteTime(notes: string | null, field: 'Check-in' | 'Check-out'): string | null {
  const raw = notes?.match(new RegExp(`${field}:\\s*([^|]+)`, 'i'))?.[1]?.trim()
  return raw ? parseClockTime(raw) : null
}

/** Marcas de la app que dicen que las fechas de la reserva pueden no ser las de Airbnb. */
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

const RESERVATION_FIELDS = 'id, property_id, check_in, check_out, notes, pending_change'

export async function loadSnapshot(db: ReadDb, query: AvailabilityQuery, now: Date, signal?: AbortSignal): Promise<SourceSnapshot> {
  const ids = [...CATALOG_PROPERTY_IDS]
  const from = addDays(query.arrival, -NEIGHBOR_MARGIN_DAYS)
  const to = addDays(query.departure, NEIGHBOR_MARGIN_DAYS)
  const withSignal = <Q extends { abortSignal?: (s: AbortSignal) => Q }>(q: Q): Q => (signal && q.abortSignal ? q.abortSignal(signal) : q)

  try {
    const [runRes, propRes, rulesRes, windowRes, flaggedRes] = await Promise.all([
      withSignal(db.from('calendar_sync_runs').select('completed_at, coverage_from, coverage_to, property_ids')
        .eq('status', 'complete').eq('verified', true).not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }).limit(1)),
      withSignal(db.from('properties').select('id, capacity, active').in('id', ids)),
      withSignal(db.from('availability_rules').select(
        'property_id, min_nights, max_nights, min_nights_overrides, advance_notice_hours, booking_window_days, ' +
        'preparation_nights, same_day_turnover, turnover_hours, check_in_days, check_out_days, check_in_time, check_out_time',
      ).in('property_id', ids).not('verified_at', 'is', null)),
      // Reservas y bloqueos vigentes que tocan la estadía o sus vecinos. Las canceladas no ocupan.
      withSignal(db.from('reservations').select(RESERVATION_FIELDS).in('property_id', ids)
        .in('status', ['confirmed', 'blocked']).lte('check_in', to).gte('check_out', from)),
      // Reservas futuras con cambios pendientes o fechas por verificar: podrían moverse a la estadía.
      withSignal(db.from('reservations').select(RESERVATION_FIELDS).in('property_id', ids)
        .in('status', ['confirmed', 'blocked']).gte('check_out', todayInBogota(now))
        .or('pending_change.not.is.null,notes.ilike.*⚠️*')),
    ])

    const runs = check<SyncRunRow[]>(runRes, 'calendar_sync_runs')
    const properties = check<PropertyRow[]>(propRes, 'properties')
    const rules = check<RulesRow[]>(rulesRes, 'availability_rules')
    const reservations = [...check<ReservationRow[]>(windowRes, 'reservations'), ...check<ReservationRow[]>(flaggedRes, 'reservations')]

    const run = runs[0]
    if (!run) return { kind: 'problem', status: 'unconfigured', reason: 'no hay sincronización de calendario verificada' }

    const synced = new Set(run.property_ids ?? [])
    const missingFromRun = ids.filter(id => !synced.has(id))
    const coverage = run.coverage_from && run.coverage_to ? { from: run.coverage_from, to: run.coverage_to } : null

    const seen = new Set<string>()
    const periodsByProperty = new Map<string, BusyPeriod[]>()
    for (const r of reservations) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      periodsByProperty.set(r.property_id, [...(periodsByProperty.get(r.property_id) ?? []), toPeriod(r)])
    }
    const propById = new Map(properties.map(p => [p.id, p]))
    const rulesById = new Map(rules.map(r => [r.property_id, r]))

    const units: UnitSnapshot[] = CASA_BLUE_CATALOG.map(c => {
      const prop = propById.get(c.propertyId)
      const conflicts: string[] = []
      if (!prop) conflicts.push('no existe en AirAdmin')
      else {
        if (prop.active === false) conflicts.push('inactivo en AirAdmin')
        if (prop.capacity !== c.capacity) conflicts.push(`capacidad ${prop.capacity} en AirAdmin vs ${c.capacity} en el catálogo`)
      }
      if (missingFromRun.includes(c.propertyId)) conflicts.push('fuera de la última sincronización verificada')
      const r = rulesById.get(c.propertyId)
      return {
        slug: c.slug,
        capacity: c.capacity,
        conflicts,
        rules: r ? toRules(r) : null,
        periods: periodsByProperty.get(c.propertyId) ?? [],
      }
    })

    return { kind: 'data', lastSyncedAt: run.completed_at, coverage, units }
  } catch (err) {
    if (err instanceof SourceError) return { kind: 'problem', status: err.status, reason: err.message }
    return { kind: 'problem', status: 'unavailable', reason: err instanceof Error ? err.name : 'error' }
  }
}

/** Conflictos entre el catálogo y AirAdmin, para registros internos y el documento de entrega. */
export function catalogConflicts(snapshot: SourceSnapshot): Array<{ slug: string; conflicts: string[] }> {
  if (snapshot.kind !== 'data') return []
  return snapshot.units.filter(u => u.conflicts.length > 0).map(u => ({ slug: u.slug, conflicts: u.conflicts }))
}
