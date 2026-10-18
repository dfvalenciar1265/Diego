import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'
import type { SourceSnapshot, UnitRules, UnitSnapshot } from '@/lib/public-availability/compute'

/** 18-oct-2026 01:30 en Bogotá (06:30 UTC). Todas las pruebas usan datos sintéticos. */
export const NOW = new Date('2026-10-18T06:30:00Z')
export const SYNCED_AT = '2026-10-18T06:25:00Z'
export const COVERAGE = { from: '2026-10-01', to: '2027-04-30' }

export const RULES: UnitRules = {
  minNights: 2,
  maxNights: 30,
  minNightsOverrides: [],
  advanceNoticeHours: 0,
  bookingWindowDays: 365,
  preparationNights: 0,
  sameDayTurnover: true,
  turnoverHours: null,
  checkInDays: null,
  checkOutDays: null,
  checkInTime: '15:00',
  checkOutTime: '11:00',
}

export function unit(slug: string, over: Partial<UnitSnapshot> = {}): UnitSnapshot {
  const c = CASA_BLUE_CATALOG.find(u => u.slug === slug)!
  return { slug, capacity: c.capacity, conflicts: [], rules: { ...RULES }, periods: [], ...over }
}

export function snapshot(over: Partial<Record<string, Partial<UnitSnapshot>>> = {}, extra: Partial<Extract<SourceSnapshot, { kind: 'data' }>> = {}): SourceSnapshot {
  return {
    kind: 'data',
    lastSyncedAt: SYNCED_AT,
    coverage: COVERAGE,
    units: CASA_BLUE_CATALOG.map(c => unit(c.slug, over[c.slug])),
    ...extra,
  }
}

export interface FakeDbOptions {
  /** Resultado por tabla; `reservations:flagged` es la segunda consulta (con .or). */
  results?: Record<string, { data?: unknown; error?: { code?: string; message?: string } | null }>
  delayMs?: number
  throws?: boolean
}

/** Doble de supabase-js: encadena filtros, registra cada llamada y nunca toca la red. */
export function fakeDb(opts: FakeDbOptions = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const db = {
    calls,
    from(table: string) {
      let flagged = false
      const builder: Record<string, unknown> = {}
      const chain = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args })
        if (method === 'or') flagged = true
        return builder
      }
      for (const m of ['select', 'eq', 'neq', 'in', 'lte', 'gte', 'lt', 'gt', 'not', 'or', 'order', 'limit', 'abortSignal',
        'insert', 'update', 'delete', 'upsert', 'rpc']) builder[m] = chain(m)
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (opts.throws) return reject(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=secret'))
        const key = table === 'reservations' && flagged ? 'reservations:flagged' : table
        const r = opts.results?.[key] ?? { data: [] }
        const value = { data: r.data ?? null, error: r.error ?? null }
        if (opts.delayMs) setTimeout(() => resolve(value), opts.delayMs)
        else resolve(value)
      }
      return builder
    },
  }
  return db
}

export const SYNC_RUN = {
  completed_at: SYNCED_AT,
  coverage_from: COVERAGE.from,
  coverage_to: COVERAGE.to,
  property_ids: CASA_BLUE_CATALOG.map(u => u.propertyId),
}

export const PROPERTIES_OK = CASA_BLUE_CATALOG.map(u => ({ id: u.propertyId, capacity: u.capacity, active: true }))

export const RULES_ROWS = CASA_BLUE_CATALOG.map(u => ({
  property_id: u.propertyId,
  min_nights: 2,
  max_nights: 30,
  min_nights_overrides: [],
  advance_notice_hours: 0,
  booking_window_days: 365,
  preparation_nights: 0,
  same_day_turnover: true,
  turnover_hours: null,
  check_in_days: null,
  check_out_days: null,
  check_in_time: '15:00:00',
  check_out_time: '11:00:00',
}))
