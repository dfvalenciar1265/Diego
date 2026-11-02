/**
 * Calendario maestro autorizado por Diego el 1-nov-2026 para los próximos 180 días.
 * Lee reservas y bloqueos de AirAdmin en una sola instantánea SQL, sin depender de iCal/Gmail.
 * La hora de lectura NO se presenta como una sincronización con Airbnb.
 */
import { isIsoDate } from '@/lib/gpt-api/dates'
import { CASA_BLUE_CATALOG } from './catalog'
import type { BusyPeriod, SourceSnapshot } from './compute'
import type { AvailabilityQuery } from './query'
import { toRules, type ReadDb } from './source'

interface CalendarRow {
  property_id: string
  start: string
  end: string
  dates_uncertain: boolean
  alternate: { start: string; end: string } | null
}
interface CalendarSnapshot {
  read_at: string
  coverage: { from: string; to: string }
  properties: Array<{ id: string; active: boolean; capacity: number | null }>
  rules: Array<Parameters<typeof toRules>[0]>
  reservations: CalendarRow[]
}

export async function loadAirAdminSnapshot(db: ReadDb, query: AvailabilityQuery, signal?: AbortSignal): Promise<SourceSnapshot> {
  const problem = (status: 'unconfigured' | 'unavailable' | 'incomplete', reason: string): SourceSnapshot => ({ kind: 'problem', source: 'airadmin', status, reason })
  try {
    const request = db.rpc('read_casa_blue_airadmin_availability', { p_arrival: query.arrival, p_departure: query.departure })
    const { data, error } = await (signal && request.abortSignal ? request.abortSignal(signal) : request)
    if (error) return problem(['42883', 'PGRST202'].includes(error.code) ? 'unconfigured' : 'unavailable', 'no se pudo consultar el calendario de AirAdmin')
    const rows = data as CalendarSnapshot | null
    if (!rows || !Number.isFinite(Date.parse(rows.read_at)) || !rows.coverage ||
        !isIsoDate(rows.coverage.from) || !isIsoDate(rows.coverage.to) || rows.coverage.from > rows.coverage.to ||
        !Array.isArray(rows.properties) || !Array.isArray(rows.rules) || !Array.isArray(rows.reservations)) {
      return problem('incomplete', 'lectura incompleta del calendario de AirAdmin')
    }
    const validPeriod = (p: { start: string; end: string }) => isIsoDate(p.start) && isIsoDate(p.end) && p.start < p.end
    if (rows.reservations.some(r => !validPeriod(r) || (r.alternate && !validPeriod(r.alternate)))) {
      return problem('incomplete', 'fechas por revisar en el calendario de AirAdmin')
    }
    return {
      kind: 'data', source: 'airadmin', calendarReadAt: rows.read_at, lastSyncedAt: null, coverage: rows.coverage,
      units: CASA_BLUE_CATALOG.map(c => {
        const properties = rows.properties.filter(p => p.id === c.propertyId)
        const rules = rows.rules.filter(r => r.property_id === c.propertyId)
        const conflicts: string[] = []
        if (properties.length !== 1 || !properties[0].active) conflicts.push('apartamento ausente o inactivo en AirAdmin')
        if (query.guests !== undefined && properties[0]?.capacity !== c.capacity) conflicts.push('capacidad por revisar')
        const periods: BusyPeriod[] = rows.reservations.filter(r => r.property_id === c.propertyId).map(r => ({
          start: r.start, end: r.end, datesUncertain: r.dates_uncertain, alternate: r.alternate,
        }))
        return { slug: c.slug, capacity: c.capacity, conflicts, rules: rules.length === 1 ? toRules(rules[0]) : null, periods }
      }),
    }
  } catch {
    return problem('unavailable', 'no se pudo leer el calendario de AirAdmin')
  }
}
