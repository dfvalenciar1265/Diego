// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'
import { handleAvailability, handlePreflight, type HandlerDeps } from '@/lib/public-availability/handler'
import { RateLimiter, allowedOrigins } from '@/lib/public-availability/http'
import { parseAvailabilityQuery } from '@/lib/public-availability/query'
import { loadSnapshot, toPeriod } from '@/lib/public-availability/source'
import { NOW, PROPERTIES_OK, RULES_ROWS, SYNC_RUN, fakeDb, type FakeDbOptions } from './fixtures'

const BASE = 'http://localhost:4000/api/public/casa-blue/availability'
const ORIGIN = 'https://casabluecartagena.com'
const P = (qs: string) => new URLSearchParams(qs)

const READY: FakeDbOptions['results'] = {
  calendar_sync_runs: { data: [SYNC_RUN] },
  properties: { data: PROPERTIES_OK },
  availability_rules: { data: RULES_ROWS },
  reservations: { data: [] },
}

function deps(over: Partial<HandlerDeps> & { dbOpts?: FakeDbOptions } = {}) {
  const db = fakeDb(over.dbOpts ?? { results: READY })
  const log = vi.fn()
  return { db, log, deps: { db: () => db, now: () => NOW, limiter: new RateLimiter(), log, env: { NODE_ENV: 'production' }, ...over } as HandlerDeps }
}

const get = (qs: string, headers: Record<string, string> = { origin: ORIGIN }) => new Request(`${BASE}?${qs}`, { headers })
const OK_QS = 'arrival=2026-11-10&departure=2026-11-13&guests=2'

describe('parseAvailabilityQuery', () => {
  it('acepta una consulta válida', () => {
    expect(parseAvailabilityQuery(P(OK_QS), NOW)).toEqual({ ok: true, query: { arrival: '2026-11-10', departure: '2026-11-13', guests: 2 } })
  })

  it.each([
    ['', 'falta todo'],
    ['arrival=2026-11-10&departure=2026-11-13', 'falta guests'],
    ['arrival=2026-02-30&departure=2026-03-02&guests=2', 'fecha imposible'],
    ['arrival=2026-11-1&departure=2026-11-13&guests=2', 'formato'],
    ['arrival=11/10/2026&departure=2026-11-13&guests=2', 'formato'],
    ['arrival=2026-11-10&departure=2026-11-10&guests=2', 'salida igual a llegada'],
    ['arrival=2026-11-13&departure=2026-11-10&guests=2', 'salida antes'],
    ['arrival=2026-10-17&departure=2026-10-20&guests=2', 'llegada en el pasado'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=0', 'cero huéspedes'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=9', 'nueve huéspedes'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=2.5', 'no entero'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=02', 'cero a la izquierda'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=%202', 'espacios'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=-1', 'negativo'],
    ['arrival=2026-11-10&arrival=2026-11-11&departure=2026-11-13&guests=2', 'repetido'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=2&property=palmetto-1001', 'elige propiedad'],
    ['arrival=2026-11-10&departure=2026-11-13&guests=2&tenant=otro', 'elige tenant'],
    ['arrival=2026-11-10&departure=2027-11-13&guests=2', 'demasiadas noches'],
  ])('rechaza %s (%s)', qs => {
    expect(parseAvailabilityQuery(P(qs), NOW).ok).toBe(false)
  })

  it('"hoy" es el día de Bogotá, no el de UTC', () => {
    // 19-oct 04:30 UTC = 18-oct 23:30 en Bogotá: llegar el 18 todavía vale.
    expect(parseAvailabilityQuery(P('arrival=2026-10-18&departure=2026-10-20&guests=2'), new Date('2026-10-19T04:30:00Z')).ok).toBe(true)
    // 19-oct 05:00 UTC = medianoche en Bogotá: el 18 ya pasó.
    expect(parseAvailabilityQuery(P('arrival=2026-10-18&departure=2026-10-20&guests=2'), new Date('2026-10-19T05:00:00Z')).ok).toBe(false)
  })
})

describe('GET: respuestas', () => {
  it('200 con JSON, no-store y CORS del sitio', async () => {
    const { deps: d } = deps()
    const res = await handleAvailability(get(OK_QS), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    const body = await res.json()
    expect(body.sourceStatus).toBe('ready')
    expect(body.apartments.map((a: { slug: string }) => a.slug)).toEqual(CASA_BLUE_CATALOG.map(u => u.slug))
    expect(body.apartments.every((a: { status: string }) => a.status === 'available')).toBe(true)
  })

  it('400 en consultas inválidas, sin datos de la fuente y con CORS para que el sitio lea el error', async () => {
    const { deps: d, db } = deps()
    const res = await handleAvailability(get('arrival=2026-11-10&departure=2026-11-13&guests=12'), d)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await res.json()).toEqual({ error: 'invalid_request', message: expect.any(String) })
    expect(db.calls).toHaveLength(0)
  })

  it('origen no confirmado: responde pero sin cabecera CORS', async () => {
    const { deps: d } = deps()
    const res = await handleAvailability(get(OK_QS, { origin: 'https://evil.example' }), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toContain('Origin')
  })

  it('429 al exceder el límite por IP, con Retry-After', async () => {
    const { deps: d } = deps({ limiter: new RateLimiter(2, 60_000, 100) })
    const h = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }
    expect((await handleAvailability(get(OK_QS, h), d)).status).toBe(200)
    expect((await handleAvailability(get(OK_QS, h), d)).status).toBe(200)
    const limited = await handleAvailability(get(OK_QS, h), d)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(limited.headers.get('cache-control')).toBe('no-store')
    // Otra IP sigue pasando.
    expect((await handleAvailability(get(OK_QS, { origin: ORIGIN, 'x-forwarded-for': '198.51.100.2' }), d)).status).toBe(200)
  })

  it('el límite se reinicia al terminar la ventana', () => {
    const l = new RateLimiter(1, 1000, 100)
    expect(l.take('a', 0)).toBeNull()
    expect(l.take('a', 500)).toBe(1)
    expect(l.take('a', 1000)).toBeNull()
  })
})

describe('GET: fallos de la fuente', () => {
  const ok = (body: { sourceStatus: string; apartments: { status: string }[] }, status: string) => {
    expect(body.sourceStatus).toBe(status)
    expect(body.apartments).toHaveLength(8)
    expect(body.apartments.every(a => a.status === 'unknown')).toBe(true)
  }

  it('sin variables de Supabase → unconfigured', async () => {
    const { deps: d } = deps({ db: () => null })
    ok(await (await handleAvailability(get(OK_QS), d)).json(), 'unconfigured')
  })

  it('tablas de sincronización/reglas sin crear → unconfigured', async () => {
    const { deps: d } = deps({ dbOpts: { results: { ...READY, calendar_sync_runs: { error: { code: 'PGRST205', message: 'Could not find the table' } } } } })
    ok(await (await handleAvailability(get(OK_QS), d)).json(), 'unconfigured')
  })

  it('sin corrida verificada → unconfigured', async () => {
    const { deps: d } = deps({ dbOpts: { results: { ...READY, calendar_sync_runs: { data: [] } } } })
    ok(await (await handleAvailability(get(OK_QS), d)).json(), 'unconfigured')
  })

  it('base de datos caída → unavailable, sin filtrar el error', async () => {
    const { deps: d } = deps({ dbOpts: { throws: true } })
    const res = await handleAvailability(get(OK_QS), d)
    const text = await res.clone().text()
    expect(res.status).toBe(200)
    ok(JSON.parse(text), 'unavailable')
    for (const leak of ['ECONNREFUSED', 'password', 'secret', '10.0.0.1', 'error', 'stack']) expect(text).not.toContain(leak)
  })

  it('error de consulta → unavailable', async () => {
    const { deps: d } = deps({ dbOpts: { results: { ...READY, reservations: { error: { code: '57014', message: 'canceling statement due to statement timeout' } } } } })
    const text = await (await handleAvailability(get(OK_QS), d)).text()
    ok(JSON.parse(text), 'unavailable')
    expect(text).not.toContain('statement')
  })

  it('fuente lenta → unavailable antes de los 6 s del sitio', async () => {
    vi.useFakeTimers()
    try {
      const { deps: d } = deps({ dbOpts: { results: READY, delayMs: 10_000 } })
      const pending = handleAvailability(get(OK_QS), d)
      await vi.advanceTimersByTimeAsync(3_600)
      ok(await (await pending).json(), 'unavailable')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sincronización antigua → stale', async () => {
    const { deps: d } = deps({ dbOpts: { results: { ...READY, calendar_sync_runs: { data: [{ ...SYNC_RUN, completed_at: '2026-10-18T05:00:00Z' }] } } } })
    ok(await (await handleAvailability(get(OK_QS), d)).json(), 'stale')
  })

  it('consulta fuera de cobertura → incomplete', async () => {
    const { deps: d } = deps()
    ok(await (await handleAvailability(get('arrival=2027-06-01&departure=2027-06-05&guests=2'), d)).json(), 'incomplete')
  })
})

describe('GET: datos sintéticos de punta a punta', () => {
  const PROPERTY = (slug: string) => CASA_BLUE_CATALOG.find(u => u.slug === slug)!.propertyId
  const PRIVATE = {
    id: 'res-1', property_id: PROPERTY('palmetto-1001'), check_in: '2026-11-11', check_out: '2026-11-14',
    notes: 'Huésped: Ana Pérez | Código: HMABC123 | Tel +57 300 000 0000 | Check-out: 11:00 AM', pending_change: null,
    guest_name: 'Ana Pérez', amount: 1234567, airbnb_code: 'HMABC123',
  }

  it('reserva → occupied; conflicto de capacidad → unknown; sin datos privados', async () => {
    const properties = PROPERTIES_OK.map(p => p.id === PROPERTY('crespo-1214') ? { ...p, capacity: 2 } : p)
    const { deps: d, log } = deps({ dbOpts: { results: { ...READY, properties: { data: properties }, reservations: { data: [PRIVATE] } } } })
    const res = await handleAvailability(get(OK_QS), d)
    const text = await res.text()
    const body = JSON.parse(text)
    const status = (slug: string) => body.apartments.find((a: { slug: string }) => a.slug === slug).status
    expect(status('palmetto-1001')).toBe('occupied')
    expect(status('crespo-1214')).toBe('unknown')
    expect(status('tocahagua-708')).toBe('available')
    for (const leak of ['Ana', 'HMABC123', '1234567', '+57', 'res-1', '2026-11-11', '2026-11-14', ...CASA_BLUE_CATALOG.map(u => u.propertyId)]) {
      expect(text).not.toContain(leak)
    }
    expect(log).toHaveBeenCalledWith('conflictos de catálogo', ['crespo-1214: capacidad 2 en AirAdmin vs 4 en el catálogo'])
  })

  it('apartamento fuera de la última sincronización → unknown', async () => {
    const run = { ...SYNC_RUN, property_ids: SYNC_RUN.property_ids.filter(id => id !== PROPERTY('tocahagua-1208')) }
    const { deps: d } = deps({ dbOpts: { results: { ...READY, calendar_sync_runs: { data: [run] } } } })
    const body = await (await handleAvailability(get(OK_QS), d)).json()
    expect(body.apartments.find((a: { slug: string }) => a.slug === 'tocahagua-1208').status).toBe('unknown')
  })

  it('la consulta no escribe: solo SELECT, sin insert/update/delete/upsert/rpc', async () => {
    const { deps: d, db } = deps({ dbOpts: { results: { ...READY, reservations: { data: [PRIVATE] } } } })
    await handleAvailability(get(OK_QS), d)
    const methods = db.calls.map(c => c.method)
    expect(methods).toContain('select')
    for (const w of ['insert', 'update', 'delete', 'upsert', 'rpc']) expect(methods).not.toContain(w)
  })

  it('solo consulta los ocho IDs del catálogo y excluye canceladas', async () => {
    const { deps: d, db } = deps()
    await handleAvailability(get(OK_QS), d)
    const ids = [...CASA_BLUE_CATALOG.map(u => u.propertyId)]
    for (const c of db.calls.filter(c => c.method === 'in' && (c.args[0] === 'id' || c.args[0] === 'property_id'))) {
      expect(c.args[1]).toEqual(ids)
    }
    const statusFilters = db.calls.filter(c => c.table === 'reservations' && c.method === 'in' && c.args[0] === 'status')
    expect(statusFilters.length).toBe(2)
    for (const c of statusFilters) expect(c.args[1]).toEqual(['confirmed', 'blocked'])
  })
})

describe('source: periodos', () => {
  it('lee la hora de salida de las notas y marca fechas dudosas o cambios pendientes', () => {
    const base = { id: 'x', property_id: 'p', check_in: '2026-11-01', check_out: '2026-11-04', pending_change: null }
    expect(toPeriod({ ...base, notes: 'Check-in: 3:00 PM | Check-out: 1:00 PM' })).toMatchObject({ startTime: '15:00', endTime: '13:00', datesUncertain: false, alternate: null })
    expect(toPeriod({ ...base, notes: 'x | ⚠️ Fechas actualizadas — verificar en Airbnb' }).datesUncertain).toBe(true)
    expect(toPeriod({ ...base, notes: '', pending_change: { check_in_to: '2026-11-02', check_out_to: null } }).alternate).toEqual({ start: '2026-11-02', end: '2026-11-04' })
    expect(toPeriod({ ...base, notes: '', pending_change: { check_in_to: null, check_out_to: null } }).alternate).toBeNull()
  })

  it('reglas sin verified_at no cuentan (filtra por verified_at)', async () => {
    const db = fakeDb({ results: READY })
    await loadSnapshot(db, { arrival: '2026-11-10', departure: '2026-11-13', guests: 2 }, NOW)
    expect(db.calls).toContainEqual({ table: 'availability_rules', method: 'not', args: ['verified_at', 'is', null] })
    expect(db.calls).toContainEqual({ table: 'calendar_sync_runs', method: 'eq', args: ['verified', true] })
  })
})

describe('CORS', () => {
  it('solo el dominio de producción por defecto', () => {
    expect([...allowedOrigins({ NODE_ENV: 'production' })]).toEqual([ORIGIN])
  })

  it('orígenes extra confirmados solo https; desarrollo solo fuera de producción', () => {
    const env = { CASA_BLUE_CORS_ORIGINS: 'https://www.casabluecartagena.com, http://inseguro.com', CASA_BLUE_CORS_DEV_ORIGINS: 'http://localhost:4321' }
    expect(allowedOrigins({ ...env, NODE_ENV: 'production' })).toEqual(new Set([ORIGIN, 'https://www.casabluecartagena.com']))
    expect(allowedOrigins({ ...env, NODE_ENV: 'development' }).has('http://localhost:4321')).toBe(true)
  })

  it('preflight: 204 para el sitio, 403 para otros', () => {
    const ok = handlePreflight(new Request(BASE, { method: 'OPTIONS', headers: { origin: ORIGIN } }), { NODE_ENV: 'production' })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    const bad = handlePreflight(new Request(BASE, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), { NODE_ENV: 'production' })
    expect(bad.status).toBe(403)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
})
