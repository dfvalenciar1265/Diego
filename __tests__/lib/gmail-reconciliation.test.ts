import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, type Row } from '../helpers/fake-db'
import { runGmailSync } from '@/lib/gmail-reconciliation/runner'
import { readGmailStatus } from '@/lib/gmail-reconciliation/status'
import { fetchAirbnbEmailPage, GmailCursorExpiredError, getAccessToken } from '@/lib/gmail-sync'
import type { GmailRun, GmailPage } from '@/lib/gmail-reconciliation/types'

const connection = '2026-10-29T05:00:00.000Z'
const now = Date.parse('2026-10-30T05:15:00.000Z')
const run = (extra: Partial<GmailRun> = {}): GmailRun & Row => ({
  id: '00000000-0000-0000-0000-00000000a101', root_id: 'root', parent_id: null, status: 'running',
  connection_version: connection, started_at: '2026-10-30T05:14:00.000Z', finished_at: null,
  lease_until: '2026-10-30T05:24:00.000Z', scope_from: '2026-10-29T05:00:00.000Z',
  scope_to: '2026-10-30T05:00:00.000Z', next_page_cursor: null, scan_complete: false, stats: {}, error_code: null, ...extra,
})
const settings = [{ key: 'gmail_refresh_token', value: 'dummy-synthetic-value', updated_at: connection }]
const page = (next: string | null = null): GmailPage => ({ events: [], next_cursor: next, threads_fetched: 0, messages_seen: 0 })
function harness(extra: Partial<GmailRun> = {}, fail?: string) {
  const current = run(extra)
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === fail) return { data: null, error: { message: 'Error privado sintético' } }
    if (name === 'gmail_sync_begin') return { data: { run: current, busy: false }, error: null }
    if (name === 'gmail_sync_checkpoint') current.scan_complete = args.p_complete as boolean
    if (name === 'gmail_sync_finish') return { data: { ...current, status: args.p_status, error_code: args.p_error }, error: null }
    return { data: {}, error: null }
  })
  const db = fakeDb({ app_settings: settings, gmail_sync_events: [] }, { rpc })
  const token = vi.fn(async () => 'dummy-synthetic-access')
  return { db, rpc, token, now: () => now, id: () => current.id }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('lector paginado de Gmail con mensajes sintéticos', () => {
  const from = '2026-10-30T05:00:00.000Z', to = '2026-10-31T05:00:00.000Z'
  const message = (id: string, date: string | null, sender = 'Airbnb <automated@airbnb.com>') => ({
    id, ...(date ? { internalDate: String(Date.parse(date)) } : {}), payload: {
      headers: [{ name: 'Subject', value: 'Cancelada: reservación HMSYNC0001' }, { name: 'From', value: sender }],
      body: { data: Buffer.from('Código de confirmación: HMSYNC0001').toString('base64url') },
    },
  })
  it('acota por instantes de medianoche en Bogotá y excluye mensajes viejos y respuestas del huésped', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ threads: [{ id: 'thread-synthetic' }], nextPageToken: 'next-synthetic' }))
      .mockResolvedValueOnce(Response.json({ messages: [message('old', '2026-10-30T04:59:00Z'), message('current', '2026-10-30T05:01:00Z'),
        message('guest-reply', '2026-10-30T06:00:00Z', 'huesped@example.test'), message('end', to)] }))
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchAirbnbEmailPage('dummy', from, to, null)
    expect(result.events.map(e => e.message_id)).toEqual(['current'])
    expect(result.events[0].kind).toBe('cancellation')
    expect(result.next_cursor).toBe('next-synthetic')
    const query = new URL(fetcher.mock.calls[0][0]).searchParams.get('q')
    expect(query).toContain(`after:${Date.parse(from) / 1000}`)
    expect(query).toContain(`before:${Date.parse(to) / 1000}`)
  })
  it('deja pendiente un mensaje sin fecha verificable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ threads: [{ id: 'synthetic' }] }))
      .mockResolvedValueOnce(Response.json({ messages: [message('unknown-date', null)] })))
    const result = await fetchAirbnbEmailPage('dummy', from, to, null)
    expect(result.events).toMatchObject([{ kind: 'unparsed', source_at: null }])
  })
  it('un fallo al leer un hilo no produce una página aparentemente vacía', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ threads: [{ id: 'synthetic' }] }))
      .mockResolvedValueOnce(new Response('Respuesta privada sintética', { status: 503 })))
    await expect(fetchAirbnbEmailPage('dummy', from, to, null)).rejects.toThrow('Lectura de Gmail incompleta')
  })
  it('una política de cancelación y un formato nuevo no autorizan cancelar una reserva', async () => {
    const email = message('new-format', '2026-10-30T06:00:00Z')
    email.payload.headers[0].value = 'Reservation notification: HMSYNC0001'
    email.payload.body.data = Buffer.from('Confirmation code: HMSYNC0001\nBooking cancellation policy\nEstas fechas están disponibles').toString('base64url')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ threads: [{ id: 'synthetic' }] }))
      .mockResolvedValueOnce(Response.json({ messages: [email] })))
    const result = await fetchAirbnbEmailPage('dummy', from, to, null)
    expect(result.events).toMatchObject([{ kind: 'unparsed' }])
  })
  it('distingue un cursor rechazado y no expone la respuesta del proveedor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Respuesta privada sintética', { status: 400 })))
    await expect(fetchAirbnbEmailPage('dummy', from, to, 'expired')).rejects.toBeInstanceOf(GmailCursorExpiredError)
    await expect(getAccessToken('dummy')).rejects.toThrow('Gmail no disponible (HTTP 400)')
  })
})

describe('corrida compartida, recuperación y resultados verificables', () => {
  it('si hay otro trabajador no accede a Gmail ni aplica cambios', async () => {
    const rpc = vi.fn(() => ({ data: { run: run(), busy: true }, error: null }))
    const token = vi.fn()
    const result = await runGmailSync({ via: 'cron' }, { db: fakeDb({}, { rpc }), token })
    expect(result.state).toBe('busy'); expect(token).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('una lectura vacía completa se certifica solo después del checkpoint y mantenimiento', async () => {
    const h = harness()
    const result = await runGmailSync({ via: 'cron' }, { ...h, page: async () => page() })
    expect(result).toMatchObject({ ok: true, state: 'complete', scan_complete: true })
    expect(h.rpc.mock.calls.map(c => c[0])).toEqual(['gmail_sync_begin', 'gmail_sync_checkpoint', 'gmail_sync_maintenance', 'gmail_sync_finish'])
    expect(JSON.stringify(result)).not.toMatch(/dummy|next_page_cursor|connection_version/)
  })
  it('el botón normal pide un alcance incremental; solo days explícito pide historial', async () => {
    const h = harness()
    await runGmailSync({ via: 'manual', actorId: 'synthetic-admin' }, { ...h, page: async () => page() })
    expect(h.rpc).toHaveBeenCalledWith('gmail_sync_begin', expect.objectContaining({ p_trigger: 'manual', p_days: null }))
    const historical = harness()
    await runGmailSync({ via: 'manual', actorId: 'synthetic-admin', days: 365 }, { ...historical, page: async () => page() })
    expect(historical.rpc).toHaveBeenCalledWith('gmail_sync_begin', expect.objectContaining({ p_days: 365 }))
  })
  it('limita las páginas y conserva el cursor de continuación sin marcar todo al día', async () => {
    const h = harness(); let index = 0
    const result = await runGmailSync({ via: 'cron' }, { ...h, page: async () => page(`next-${++index}`) })
    expect(index).toBe(3); expect(result).toMatchObject({ ok: false, state: 'partial', scan_complete: false })
    expect(h.rpc).toHaveBeenCalledWith('gmail_sync_checkpoint', expect.objectContaining({ p_cursor: 'next-3', p_complete: false }))
  })
  it('recupera un cursor caducado releyendo exactamente el mismo alcance', async () => {
    const h = harness({ next_page_cursor: 'expired' })
    const fetchPage = vi.fn().mockRejectedValueOnce(new GmailCursorExpiredError()).mockResolvedValueOnce(page())
    expect((await runGmailSync({ via: 'cron' }, { ...h, page: fetchPage })).ok).toBe(true)
    expect(fetchPage.mock.calls.map(c => c.slice(1))).toEqual([
      [run().scope_from, run().scope_to, 'expired'], [run().scope_from, run().scope_to, null],
    ])
  })
  it('no adelanta el cursor si una escritura no pudo confirmarse', async () => {
    const h = harness({}, 'gmail_sync_apply')
    const result = await runGmailSync({ via: 'cron' }, { ...h, page: async () => ({ ...page('next'), events: [{ message_id: 'synthetic', kind: 'unparsed', source_at: null, payload: {} }] }) })
    expect(result.ok).toBe(false)
    expect(h.rpc.mock.calls.map(c => c[0])).not.toContain('gmail_sync_checkpoint')
    expect(h.rpc).toHaveBeenLastCalledWith('gmail_sync_finish', expect.objectContaining({ p_status: 'failed', p_error: 'database_error' }))
  })
  it('no publica errores privados de OAuth y deja registrado el intento fallido', async () => {
    const h = harness()
    const result = await runGmailSync({ via: 'manual', actorId: 'synthetic-admin' }, { ...h, token: async () => { throw new Error('Respuesta privada sintética') } })
    expect(result.state).toBe('failed'); expect(JSON.stringify(result)).not.toContain('privada')
    expect(h.rpc).toHaveBeenLastCalledWith('gmail_sync_finish', expect.objectContaining({ p_error: 'gmail_unavailable' }))
  })
  it('un resultado final sin confirmar se presenta como incierto', async () => {
    const h = harness({}, 'gmail_sync_finish')
    const result = await runGmailSync({ via: 'cron' }, { ...h, page: async () => page() })
    expect(result).toMatchObject({ ok: false, state: 'failed' }); expect(result.error).toContain('incierto')
  })
  it('prioriza pendientes menos recientemente intentados, para que los errores nuevos no queden detrás de conflictos antiguos', async () => {
    const h = harness()
    const events = [
      { message_id: 'recently-tried', kind: 'unparsed', source_at: null, payload: {}, status: 'conflict', connection_version: connection, created_at: '2026-01-01', last_attempt_at: '2026-10-30T05:10:00Z' },
      { message_id: 'waiting', kind: 'unparsed', source_at: null, payload: {}, status: 'error', connection_version: connection, created_at: '2026-10-29', last_attempt_at: '2026-10-29T05:00:00Z' },
    ]
    await runGmailSync({ via: 'cron' }, { ...h, db: fakeDb({ app_settings: settings, gmail_sync_events: events }, { rpc: h.rpc }), page: async () => page('more') })
    const applied = h.rpc.mock.calls.filter(c => c[0] === 'gmail_sync_apply')
    expect(applied[0][1]).toMatchObject({ p_event: { message_id: 'waiting' } })
  })
})

describe('conciliación con fake-db: conexión, demora, conflicto y proyección privada', () => {
  it('separa el intento fallido de la última lectura y cuenta todos los pendientes, sin filtrar datos privados', async () => {
    const db = fakeDb({ app_settings: settings, gmail_sync_runs: [run({ id: 'failed', status: 'failed', started_at: '2026-10-30T05:14:00Z' }),
      run({ id: 'read', status: 'partial', scan_complete: true, scope_to: '2026-10-30T04:00:00Z', started_at: '2026-10-30T04:00:00Z' }) as unknown as Row],
      gmail_sync_events: Array.from({ length: 35 }, (_, i) => ({ id: `synthetic-${i}`, connection_version: connection, status: 'conflict', kind: 'cancellation', reason: 'cancellation_without_reservation',
        created_at: String(i).padStart(2, '0'), version: 1, payload: { private: 'dummy' } })),
    })
    const status = await readGmailStatus(db, now)
    expect(status).toMatchObject({ connected: true, available: true, delayed: true, pendingCount: 35, latest: { id: 'failed' }, lastRead: { id: 'read' } })
    expect(status.issues).toHaveLength(30)
    expect(JSON.stringify(status)).not.toMatch(/payload|dummy|next_page_cursor|connection_version/)
  })
  it('una reconexión no hereda la certificación de la conexión anterior', async () => {
    const db = fakeDb({ app_settings: settings, gmail_sync_runs: [run({ connection_version: '2026-10-01T00:00:00Z', scan_complete: true })] })
    expect(await readGmailStatus(db, now)).toMatchObject({ lastRead: null, delayed: true })
  })
  it('un error de lectura no aparece como cero pendientes', async () => {
    const db = fakeDb({ app_settings: settings }, { failSelectOnce: 'gmail_sync_events' })
    expect(await readGmailStatus(db, now)).toMatchObject({ available: false, pendingCount: null })
  })
  it('identifica una corrida vencida y un alcance futuro como no comprobados', async () => {
    const db = fakeDb({ app_settings: settings, gmail_sync_runs: [run({ lease_until: '2026-10-30T05:00:00Z', scan_complete: true, scope_to: '2027-01-01T00:00:00Z' })] })
    expect(await readGmailStatus(db, now)).toMatchObject({ interrupted: true, delayed: true })
  })
})
