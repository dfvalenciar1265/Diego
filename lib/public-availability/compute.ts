/**
 * Cálculo de disponibilidad para el sitio Casa Blue. Función pura: recibe la consulta ya validada,
 * una foto de la fuente y el reloj, y devuelve exactamente la respuesta pública (sin IDs, reservas,
 * huéspedes ni intervalos).
 *
 * Noches [arrival, departure) en días de Colombia. Un periodo ocupa la consulta cuando
 * periodo.start < departure && periodo.end > arrival.
 *
 * - available: fechas libres, capacidad suficiente y todas las reglas verificadas se cumplen.
 * - occupied: un hecho confirmado lo impide (periodo ocupado, capacidad o una regla verificada).
 * - unknown: no se puede confirmar (conflicto de catálogo, reglas sin verificar, fechas dudosas…).
 * Si la fuente no está lista, las ocho unidades son unknown.
 */
import { CASA_BLUE_CATALOG } from './catalog'
import type { AvailabilityQuery } from './query'
import { addDays, daysBetween, todayInBogota } from '@/lib/gpt-api/dates'

export type SourceStatus = 'ready' | 'unconfigured' | 'unavailable' | 'stale' | 'incomplete'
export type UnitStatus = 'available' | 'occupied' | 'unknown'

export interface Coverage {
  from: string   // YYYY-MM-DD, primer día cubierto
  to: string     // YYYY-MM-DD, último día cubierto
}

export interface PublicAvailability {
  query: AvailabilityQuery
  queriedAt: string
  lastSyncedAt: string | null
  coverage: Coverage | null
  sourceStatus: SourceStatus
  apartments: Array<{ slug: string; status: UnitStatus }>
}

/** Reglas de un apartamento tal como quedaron verificadas. Ninguna se inventa por defecto. */
export interface UnitRules {
  minNights: number
  maxNights: number | null                 // null = sin máximo
  /** Reglas por fecha de llegada (conjuntos de reglas / ajustes de Airbnb). `from`/`to` inclusivos. */
  dateOverrides: DateOverride[]
  advanceNoticeHours: number               // horas entre ahora y la hora de entrada
  bookingWindowDays: number | null         // null = sin límite; última noche ≤ hoy + ventana
  preparationNights: number                // noches bloqueadas antes y después de cada periodo
  sameDayTurnover: boolean                 // ¿se puede entrar el día en que otro sale?
  turnoverHours: number | null             // horas mínimas entre salida y entrada el mismo día
  checkInDays: number[] | null             // 0 = domingo … 6 = sábado; null = cualquier día
  checkOutDays: number[] | null
  checkInTime: string | null               // HH:MM
  checkOutTime: string | null              // HH:MM
}

/** Lo que cambia para las llegadas entre `from` y `to` (inclusivos). Lo que no trae, vale la regla base. */
export interface DateOverride {
  from: string
  to: string
  minNights?: number
  maxNights?: number | null
  advanceNoticeHours?: number
  checkInDays?: number[] | null
  checkOutDays?: number[] | null
}

export interface BusyPeriod {
  start: string                            // primera noche ocupada
  end: string                              // día de salida
  startTime?: string | null                // hora de entrada conocida (HH:MM)
  endTime?: string | null                  // hora de salida conocida (HH:MM)
  /** Las fechas pueden haber cambiado y nadie lo ha verificado. */
  datesUncertain?: boolean
  /** Cambio de fechas pedido o aceptado que aún no se aplicó. */
  alternate?: { start: string; end: string } | null
}

export interface UnitSnapshot {
  slug: string
  capacity: number
  /** Diferencias entre el catálogo y el sistema. Internas: nunca salen en la respuesta. */
  conflicts: string[]
  rules: UnitRules | null
  periods: BusyPeriod[]
}

export type SourceSnapshot =
  | { kind: 'problem'; status: 'unconfigured' | 'unavailable' | 'incomplete'; reason: string }
  | { kind: 'data'; lastSyncedAt: string | null; coverage: Coverage | null; units: UnitSnapshot[] }

/** Límites que hoy exige el sitio (no son una frecuencia comprobada de AirAdmin). */
export const MAX_SYNC_AGE_SECONDS = 900
export const MAX_SYNC_FUTURE_SECONDS = 60

const BOGOTA_OFFSET = '-05:00'   // Colombia no tiene horario de verano

/** Instante ISO 8601 con segundos y zona (UTC), sin milisegundos. */
export function isoInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const overlaps = (start: string, end: string, from: string, to: string) => start < to && end > from

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Estado de la fuente según sincronización y cobertura. */
function sourceStatusFor(
  snapshot: Extract<SourceSnapshot, { kind: 'data' }>,
  query: AvailabilityQuery,
  now: Date,
): SourceStatus {
  if (!snapshot.lastSyncedAt || !snapshot.coverage) return 'incomplete'
  const synced = Date.parse(snapshot.lastSyncedAt)
  if (Number.isNaN(synced)) return 'incomplete'
  const ageSeconds = (now.getTime() - synced) / 1000
  if (ageSeconds < -MAX_SYNC_FUTURE_SECONDS) return 'unavailable'   // reloj de la fuente adelantado: no es confiable
  if (ageSeconds > MAX_SYNC_AGE_SECONDS) return 'stale'
  const { from, to } = snapshot.coverage
  if (from > query.arrival || to < query.departure) return 'incomplete'
  return 'ready'
}

/** Reglas que aplican a una llegada: la base con el ajuste de esa fecha encima (el primero que la cubra). */
export function rulesForArrival(rules: UnitRules, arrival: string): UnitRules {
  const o = rules.dateOverrides.find(d => d.from <= arrival && arrival <= d.to)
  if (!o) return rules
  return {
    ...rules,
    minNights: o.minNights ?? rules.minNights,
    maxNights: o.maxNights !== undefined ? o.maxNights : rules.maxNights,
    advanceNoticeHours: o.advanceNoticeHours ?? rules.advanceNoticeHours,
    checkInDays: o.checkInDays !== undefined ? o.checkInDays : rules.checkInDays,
    checkOutDays: o.checkOutDays !== undefined ? o.checkOutDays : rules.checkOutDays,
  }
}

/** Estado de un apartamento cuando la fuente está lista. */
export function evaluateUnit(unit: UnitSnapshot, query: AvailabilityQuery, coverage: Coverage, now: Date): UnitStatus {
  const { arrival, departure, guests } = query
  const certain = unit.periods.filter(p => !p.datesUncertain)

  // Ocupación confirmada: es un hecho aunque falten reglas o haya un conflicto de catálogo.
  if (certain.some(p => overlaps(p.start, p.end, arrival, departure))) return 'occupied'
  if (unit.conflicts.length > 0) return 'unknown'
  if (guests !== undefined && guests > unit.capacity) return 'occupied'
  if (unit.periods.some(p => p.datesUncertain)) return 'unknown'
  if (unit.periods.some(p => p.alternate && overlaps(p.alternate.start, p.alternate.end, arrival, departure))) return 'unknown'

  if (!unit.rules) return 'unknown'
  const rules = rulesForArrival(unit.rules, arrival)

  const nights = daysBetween(arrival, departure)
  if (nights < rules.minNights) return 'occupied'
  if (rules.maxNights != null && nights > rules.maxNights) return 'occupied'
  if (rules.checkInDays && !rules.checkInDays.includes(weekday(arrival))) return 'occupied'
  if (rules.checkOutDays && !rules.checkOutDays.includes(weekday(departure))) return 'occupied'

  const today = todayInBogota(now)
  if (rules.bookingWindowDays != null && addDays(departure, -1) > addDays(today, rules.bookingWindowDays)) return 'occupied'

  // Airbnb's "same day" notice also has a booking cutoff hour (e.g. 8:00 p.m.) that the rules
  // table does not store, so a same-day arrival can't be confirmed: never claim it's available.
  if (rules.advanceNoticeHours === 0 && arrival === today) return 'unknown'
  if (rules.advanceNoticeHours > 0) {
    if (!rules.checkInTime) return 'unknown'
    const arrivalAt = Date.parse(`${arrival}T${rules.checkInTime}:00${BOGOTA_OFFSET}`)
    if (arrivalAt - now.getTime() < rules.advanceNoticeHours * 3_600_000) return 'occupied'
  }

  // Preparación: cada periodo bloquea N noches antes y después. Hace falta ver a los vecinos.
  const n = rules.preparationNights
  const from = addDays(arrival, -n)
  const to = addDays(departure, n)
  const needsAdjacentNight = n === 0 && (!rules.sameDayTurnover || rules.turnoverHours != null)
  const requiredFrom = needsAdjacentNight ? addDays(arrival, -1) : from
  const requiredTo = needsAdjacentNight ? addDays(departure, 1) : to
  if (coverage.from > requiredFrom || coverage.to < requiredTo) return 'unknown'
  if (certain.some(p => overlaps(p.start, p.end, from, to))) return 'occupied'

  // Entrada y salida el mismo día (solo puede pasar con preparación 0).
  const before = certain.filter(p => p.end === arrival)
  const after = certain.filter(p => p.start === departure)
  if (before.length + after.length > 0) {
    if (!rules.sameDayTurnover) return 'occupied'
    if (rules.turnoverHours != null) {
      const gaps: Array<[string | null | undefined, string | null | undefined]> = [
        ...before.map(p => [p.endTime ?? rules.checkOutTime, rules.checkInTime] as [string | null, string | null]),
        ...after.map(p => [rules.checkOutTime, p.startTime ?? rules.checkInTime] as [string | null, string | null]),
      ]
      for (const [out, inn] of gaps) {
        if (!out || !inn) return 'unknown'
        if (minutes(inn) - minutes(out) < rules.turnoverHours * 60) return 'occupied'
      }
    }
  }

  return 'available'
}

/** Respuesta pública completa: siempre los ocho apartamentos del catálogo, una vez y en orden. */
export function computeAvailability(query: AvailabilityQuery, snapshot: SourceSnapshot, now: Date): PublicAvailability {
  const base = { query: { ...query }, queriedAt: isoInstant(now) }
  const allUnknown = () => CASA_BLUE_CATALOG.map(u => ({ slug: u.slug, status: 'unknown' as UnitStatus }))

  if (snapshot.kind === 'problem') {
    return { ...base, lastSyncedAt: null, coverage: null, sourceStatus: snapshot.status, apartments: allUnknown() }
  }

  const sourceStatus = sourceStatusFor(snapshot, query, now)
  const synced = snapshot.lastSyncedAt ? Date.parse(snapshot.lastSyncedAt) : NaN
  const lastSyncedAt = Number.isNaN(synced) ? null : isoInstant(new Date(synced))
  const coverage = snapshot.coverage ? { from: snapshot.coverage.from, to: snapshot.coverage.to } : null

  if (sourceStatus !== 'ready' || !coverage) {
    return { ...base, lastSyncedAt, coverage, sourceStatus, apartments: allUnknown() }
  }

  const bySlug = new Map<string, UnitSnapshot[]>()
  for (const u of snapshot.units) bySlug.set(u.slug, [...(bySlug.get(u.slug) ?? []), u])

  const apartments = CASA_BLUE_CATALOG.map(c => {
    const found = bySlug.get(c.slug) ?? []
    // Una unidad ausente o repetida en la fuente no se puede confirmar.
    const status: UnitStatus = found.length === 1 ? evaluateUnit(found[0], query, coverage, now) : 'unknown'
    return { slug: c.slug, status }
  })

  return { ...base, lastSyncedAt, coverage, sourceStatus, apartments }
}
