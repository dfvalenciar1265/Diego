// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { loadAirAdminSnapshot } from '@/lib/public-availability/airadmin-source'
import { computeAvailability } from '@/lib/public-availability/compute'
import { handleAvailability } from '@/lib/public-availability/handler'
import { RateLimiter } from '@/lib/public-availability/http'
import { NOW, COVERAGE, PROPERTIES_OK, RULES_ROWS } from './fixtures'
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'

const Q = { arrival: '2026-11-10', departure: '2026-11-13' }
const P = CASA_BLUE_CATALOG[0].propertyId
const reservation = { property_id: P, start: '2026-11-11', end: '2026-11-12', dates_uncertain: false, alternate: null }
const rows = () => ({ read_at: NOW.toISOString(), coverage: COVERAGE, properties: PROPERTIES_OK, rules: RULES_ROWS, reservations: [reservation] })
function db(data: unknown = rows(), error: unknown = null) {
  return { rpc: vi.fn(() => Promise.resolve({ data, error })) }
}
const statuses = async (data: unknown = rows()) => computeAvailability(Q, await loadAirAdminSnapshot(db(data), Q), NOW)

describe('Casa Blue con AirAdmin como calendario maestro', () => {
  it('lee una instantánea, marca ocupación y distingue lectura de sincronización', async () => {
    const database = db()
    const result = computeAvailability(Q, await loadAirAdminSnapshot(database, Q), NOW)
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith('read_casa_blue_airadmin_availability', { p_arrival: Q.arrival, p_departure: Q.departure })
    expect(result).toMatchObject({ source: 'airadmin', sourceStatus: 'ready', calendarReadAt: '2026-10-18T06:30:00Z', lastSyncedAt: null })
    expect(result.apartments[0].status).toBe('occupied')
    expect(result.apartments.slice(1).every(a => a.status === 'available')).toBe(true)
    expect(result.query).not.toHaveProperty('guests')
    for (const secret of ['property_id', 'guest_name', 'amount', 'notes', P]) expect(JSON.stringify(result)).not.toContain(secret)
  })
  it('una fecha de salida queda libre para la siguiente llegada', async () => {
    const result = await statuses({ ...rows(), reservations: [{ ...reservation, start: '2026-11-08', end: Q.arrival }] })
    expect(result.apartments[0].status).toBe('available')
  })
  it('un cambio aún pendiente no ofrece las fechas alternativas', async () => {
    const result = await statuses({ ...rows(), reservations: [{ ...reservation, start: '2026-12-01', end: '2026-12-03', alternate: { start: Q.arrival, end: Q.departure } }] })
    expect(result.apartments[0].status).toBe('unknown')
  })
  it('una diferencia de fechas conservada impide afirmar disponibilidad', async () => {
    const result = await statuses({ ...rows(), reservations: [{ ...reservation, dates_uncertain: true }] })
    expect(result.apartments[0].status).toBe('unknown')
  })
  it('sin reglas verificadas o con apartamento inactivo no ofrece fechas libres', async () => {
    const result = await statuses({ ...rows(), reservations: [], rules: RULES_ROWS.slice(1), properties: PROPERTIES_OK.map((p,i) => ({ ...p, active: i !== 1 })) })
    expect(result.apartments.slice(0,2).every(a => a.status === 'unknown')).toBe(true)
  })
  it('ignora discrepancias de capacidad si no se consultan huéspedes', async () => {
    const result = await statuses({ ...rows(), reservations: [], properties: PROPERTIES_OK.map(p => ({ ...p, capacity: 1 })) })
    expect(result.apartments.every(a => a.status === 'available')).toBe(true)
  })
  it.each([
    { ...rows(), read_at: '2026-10-18T06:20:00Z' },
    { ...rows(), coverage: { from: '2026-10-01', to: '2026-11-12' } },
    { ...rows(), reservations: [{ ...reservation, alternate: { start: 'inválida', end: '2026-11-13' } }] },
    { ...rows(), rules: null },
    null,
  ])('lectura antigua, fuera de horizonte o incompleta conserva unknown', async data => {
    const result = await statuses(data)
    expect(result.sourceStatus).not.toBe('ready')
    expect(result.apartments.every(a => a.status === 'unknown')).toBe(true)
  })
  it('migración ausente y fallos devuelven estados seguros', async () => {
    expect(await loadAirAdminSnapshot(db(null, { code: 'PGRST202' }), Q)).toMatchObject({ kind: 'problem', status: 'unconfigured' })
    expect(await loadAirAdminSnapshot(db(null, { code: 'XX000' }), Q)).toMatchObject({ kind: 'problem', status: 'unavailable' })
    expect(await loadAirAdminSnapshot({ rpc: () => { throw new Error('privado') } }, Q)).toMatchObject({ kind: 'problem', status: 'unavailable' })
  })
  it('la API mantiene CORS, no-store y respuesta sin datos de reservas', async () => {
    const response = await handleAvailability(new Request('https://example.test/api/public/casa-blue/airadmin-availability?arrival=2026-11-10&departure=2026-11-13', { headers: { Origin: 'https://casabluecartagena.com' } }), { db: () => db(), now: () => NOW, limiter: new RateLimiter(), load: loadAirAdminSnapshot })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBe('https://casabluecartagena.com')
    expect((await response.json()).source).toBe('airadmin')
  })
})
