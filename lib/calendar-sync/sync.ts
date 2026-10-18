/**
 * Sincronizador del calendario de Airbnb (exportación iCal) para los ocho apartamentos de Casa Blue.
 *
 * Una corrida solo se certifica (calendar_sync_runs verified = true) cuando los OCHO calendarios se
 * descargaron y leyeron bien, y la cobertura está configurada. Se guarda todo junto en una
 * transacción (record_calendar_sync): o quedan los eventos nuevos y la corrida verificada, o nada.
 * Si algo falla, se registra una corrida "failed" sin tocar los eventos anteriores.
 *
 * Nunca escribe en `reservations`. Las URL iCal son secretas: vienen de variables de entorno y no
 * salen en respuestas, errores ni registros.
 */
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'
import { addDays, todayInBogota } from '@/lib/gpt-api/dates'
import { parseAirbnbIcal, type CalendarEvent } from './ical'

export const SYNC_SOURCE = 'airbnb-ical'
export const FETCH_TIMEOUT_MS = 8_000
export const MAX_FEED_BYTES = 2_000_000
const MAX_COVERAGE_DAYS = 730

/** Nombre de la variable con la URL iCal de un apartamento: mar-adentro-1305 → CASA_BLUE_ICAL_MAR_ADENTRO_1305. */
export const icalEnvName = (slug: string) => `CASA_BLUE_ICAL_${slug.toUpperCase().replace(/-/g, '_')}`
export const COVERAGE_ENV = 'CASA_BLUE_ICAL_COVERAGE_DAYS'

/** Solo se descargan calendarios de Airbnb por https (evita que una variable mal puesta apunte a otro sitio). */
export function isAirbnbIcalUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && /(^|\.)airbnb\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(u.hostname)
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WriteDb = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export interface SyncDeps {
  db: WriteDb
  env: Record<string, string | undefined>
  fetch: typeof fetch
  now: () => Date
}

export type SyncOutcome =
  | { ok: true; runId: string; dataAsOf: string; coverage: { from: string; to: string }; events: Record<string, number> }
  | { ok: false; error: string }

async function fetchFeed(f: typeof fetch, url: string): Promise<string> {
  const res = await f(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow', cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (res.url && !isAirbnbIcalUrl(res.url)) throw new Error('redirigió fuera de Airbnb')
  const text = await res.text()
  if (text.length > MAX_FEED_BYTES) throw new Error('archivo demasiado grande')
  return text
}

async function recordFailure(db: WriteDb, startedAt: Date, error: string): Promise<void> {
  const { error: dbError } = await db.from('calendar_sync_runs').insert({
    source: SYNC_SOURCE, started_at: startedAt.toISOString(), completed_at: new Date().toISOString(),
    status: 'failed', verified: false, error,
  })
  if (dbError) console.error('[calendar-sync] no pude registrar la corrida fallida', dbError.code ?? '')
}

export async function runCalendarSync(deps: SyncDeps): Promise<SyncOutcome> {
  const startedAt = deps.now()
  const fail = async (error: string): Promise<SyncOutcome> => {
    await recordFailure(deps.db, startedAt, error)
    return { ok: false, error }
  }

  const coverageDays = Number(deps.env[COVERAGE_ENV])
  if (!Number.isInteger(coverageDays) || coverageDays < 1 || coverageDays > MAX_COVERAGE_DAYS) {
    return fail(`falta ${COVERAGE_ENV} (días de la ventana de disponibilidad de Airbnb, 1–${MAX_COVERAGE_DAYS})`)
  }

  const feeds = CASA_BLUE_CATALOG.map(u => ({ unit: u, url: deps.env[icalEnvName(u.slug)]?.trim() ?? '' }))
  const missing = feeds.filter(f => !f.url).map(f => icalEnvName(f.unit.slug))
  if (missing.length > 0) return fail(`faltan URL iCal: ${missing.join(', ')}`)
  const invalid = feeds.filter(f => !isAirbnbIcalUrl(f.url)).map(f => icalEnvName(f.unit.slug))
  if (invalid.length > 0) return fail(`URL iCal que no es https de Airbnb: ${invalid.join(', ')}`)
  if (new Set(feeds.map(f => new URL(f.url).origin + new URL(f.url).pathname)).size !== feeds.length) {
    return fail('hay calendarios iCal repetidos: cada apartamento requiere su propio calendario')
  }

  // Las ocho a la vez; cualquier fallo invalida la corrida completa.
  const results = await Promise.all(feeds.map(async f => {
    try {
      const parsed = parseAirbnbIcal(await fetchFeed(deps.fetch, f.url))
      return parsed.ok ? { slug: f.unit.slug, propertyId: f.unit.propertyId, events: parsed.events } : { slug: f.unit.slug, error: parsed.error }
    } catch (err) {
      const msg = err instanceof Error && err.name !== 'TimeoutError' && err.name !== 'AbortError' ? err.message : 'tiempo de espera agotado'
      // El mensaje de fetch puede incluir la URL: solo se conserva si es uno de los nuestros.
      return { slug: f.unit.slug, error: /^(HTTP \d{3}|redirigió fuera de Airbnb|archivo demasiado grande|tiempo de espera agotado)$/.test(msg) ? msg : 'error de red' }
    }
  }))
  const failed = results.filter((r): r is { slug: string; error: string } => 'error' in r)
  if (failed.length > 0) return fail(`calendarios sin leer: ${failed.map(f => `${f.slug} (${f.error})`).join('; ')}`)

  const ok = results as Array<{ slug: string; propertyId: string; events: CalendarEvent[] }>
  const today = todayInBogota(startedAt)
  const coverage = { from: today, to: addDays(today, coverageDays) }
  const events = ok.flatMap(r => r.events.map(e => ({ property_id: r.propertyId, uid: e.uid, start: e.start, end: e.end, kind: e.kind })))

  const { data: runId, error } = await deps.db.rpc('record_calendar_sync', {
    p_source: SYNC_SOURCE,
    p_started_at: startedAt.toISOString(),
    p_data_as_of: startedAt.toISOString(),   // los datos son al menos tan frescos como el inicio de las descargas
    p_coverage_from: coverage.from,
    p_coverage_to: coverage.to,
    p_property_ids: ok.map(r => r.propertyId),
    p_events: events,
  })
  if (error || typeof runId !== 'string') return fail(`no se pudo guardar la corrida (${error?.code ?? 'sin id'})`)

  return {
    ok: true,
    runId,
    dataAsOf: startedAt.toISOString(),
    coverage,
    events: Object.fromEntries(ok.map(r => [r.slug, r.events.length])),
  }
}
