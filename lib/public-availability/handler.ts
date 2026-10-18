/**
 * GET /api/public/casa-blue/availability — sin sesión ni claves. Las dependencias se inyectan para
 * probarlo con reloj controlado y una base de datos falsa.
 *
 * 200: consulta válida (aunque no se pueda confirmar nada: estados unknown y sourceStatus ≠ ready).
 * 400: parámetros inválidos o ambiguos. 429: exceso de tráfico. Nunca sale un error interno: un
 * fallo de la fuente es sourceStatus "unavailable", jamás "cero apartamentos disponibles".
 */
import { computeAvailability, type SourceSnapshot } from './compute'
import { BASE_HEADERS, RateLimiter, allowedOrigins, clientKey, corsHeaders, withTimeout } from './http'
import { parseAvailabilityQuery } from './query'
import { loadSnapshot, type ReadDb } from './source'

/** El sitio cancela a los 6 s; la fuente tiene 3,5 s y el resto es cálculo local. */
export const SOURCE_TIMEOUT_MS = 3_500

export interface HandlerDeps {
  /** null cuando faltan las variables de entorno de Supabase. */
  db: () => ReadDb | null
  now: () => Date
  limiter: RateLimiter
  env?: Record<string, string | undefined>
  log?: (msg: string, detail?: unknown) => void
}

function respond(status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...cors, ...extra } })
}

export async function handleAvailability(req: Request, deps: HandlerDeps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), allowedOrigins(deps.env))
  const log = deps.log ?? ((msg, detail) => console.warn('[casa-blue-availability]', msg, detail ?? ''))

  const wait = deps.limiter.take(clientKey(req.headers), deps.now().getTime())
  if (wait !== null) {
    return respond(429, { error: 'rate_limited', message: 'Demasiadas consultas. Intenta de nuevo en unos segundos.' }, cors, { 'Retry-After': String(wait) })
  }

  const now = deps.now()
  const parsed = parseAvailabilityQuery(new URL(req.url).searchParams, now)
  if (!parsed.ok) return respond(400, { error: 'invalid_request', message: parsed.message }, cors)

  let snapshot: SourceSnapshot
  const db = deps.db()
  if (!db) {
    snapshot = { kind: 'problem', status: 'unconfigured', reason: 'faltan variables de Supabase' }
  } else {
    try {
      snapshot = await withTimeout(SOURCE_TIMEOUT_MS, signal => loadSnapshot(db, parsed.query, now, signal))
    } catch (err) {
      snapshot = { kind: 'problem', status: 'unavailable', reason: err instanceof Error ? err.message : 'error' }
    }
  }
  if (snapshot.kind === 'problem') log(`fuente ${snapshot.status}`, snapshot.reason)
  else {
    const conflicts = snapshot.units.filter(u => u.conflicts.length > 0).map(u => `${u.slug}: ${u.conflicts.join('; ')}`)
    if (conflicts.length > 0) log('conflictos de catálogo', conflicts)
  }

  // Se calcula con el instante de la consulta, no con el de después de leer la fuente.
  return respond(200, computeAvailability(parsed.query, snapshot, now), cors)
}

export function handlePreflight(req: Request, env?: Record<string, string | undefined>): Response {
  const origin = req.headers.get('origin')
  const allowed = allowedOrigins(env)
  const cors = corsHeaders(origin, allowed)
  const status = origin && allowed.has(origin) ? 204 : 403
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...cors } })
}
