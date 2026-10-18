// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseAirbnbIcal } from '@/lib/calendar-sync/ical'
import { COVERAGE_ENV, icalEnvName, isAirbnbIcalUrl, runCalendarSync, type WriteDb } from '@/lib/calendar-sync/sync'
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'

// Calendarios sintéticos con la forma de la exportación de Airbnb (nunca datos reales).
const feed = (events: string) => [
  'BEGIN:VCALENDAR', 'PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN', 'CALSCALE:GREGORIAN', 'VERSION:2.0',
  events, 'END:VCALENDAR',
].filter(Boolean).join('\r\n')

const event = (uid: string, start: string, end: string, summary = 'Reserved', extra = '') => [
  'BEGIN:VEVENT', `DTEND;VALUE=DATE:${end}`, `DTSTART;VALUE=DATE:${start}`, `UID:${uid}`,
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMSYNTH01\\nPhone Number (Last 4 Digits): 1234',
  `SUMMARY:${summary}`, extra, 'END:VEVENT',
].filter(Boolean).join('\r\n')

const NOW = new Date('2026-10-18T06:30:00Z')

describe('parseAirbnbIcal', () => {
  it('lee reservas y bloqueos sin guardar SUMMARY ni DESCRIPTION', () => {
    const res = parseAirbnbIcal(feed([
      event('a@airbnb.com', '20261110', '20261113'),
      event('b@airbnb.com', '20261120', '20261122', 'Airbnb (Not available)'),
    ].join('\r\n')))
    expect(res).toEqual({ ok: true, events: [
      { uid: 'a@airbnb.com', start: '2026-11-10', end: '2026-11-13', kind: 'reserved' },
      { uid: 'b@airbnb.com', start: '2026-11-20', end: '2026-11-22', kind: 'blocked' },
    ] })
    expect(JSON.stringify(res)).not.toMatch(/HMSYNTH01|1234|Reservation URL/)
  })

  it('une líneas plegadas y acepta calendario vacío', () => {
    const folded = feed(['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:2026', ' 1112', 'UID:x@air', ' bnb.com', 'SUMMARY:Reserved', 'END:VEVENT'].join('\r\n'))
    expect(parseAirbnbIcal(folded)).toEqual({ ok: true, events: [{ uid: 'x@airbnb.com', start: '2026-11-10', end: '2026-11-12', kind: 'reserved' }] })
    expect(parseAirbnbIcal(feed(''))).toEqual({ ok: true, events: [] })
  })

  it('ignora eventos cancelados y unifica duplicados idénticos', () => {
    const res = parseAirbnbIcal(feed([
      event('c@airbnb.com', '20261110', '20261113', 'Reserved', 'STATUS:CANCELLED'),
      event('d@airbnb.com', '20261201', '20261203'),
      event('d@airbnb.com', '20261201', '20261203'),
    ].join('\r\n')))
    expect(res.ok && res.events.map(e => e.uid)).toEqual(['d@airbnb.com'])
  })

  it.each([
    ['sin cierre', feed(event('a', '20261110', '20261113')).replace('\r\nEND:VCALENDAR', '')],
    ['no es Airbnb', feed(event('a', '20261110', '20261113')).replace('Airbnb Inc', 'Otro')],
    ['HTML de error', '<html><body>Not found</body></html>'],
    ['fecha con hora', feed(event('a', '20261110', '20261113').replace('DTSTART;VALUE=DATE:20261110', 'DTSTART:20261110T150000Z'))],
    ['fecha imposible', feed(event('a', '20261131', '20261202'))],
    ['salida antes', feed(event('a', '20261113', '20261110'))],
    ['sin UID', feed(event('a', '20261110', '20261113').replace('UID:a\r\n', ''))],
    ['UID repetido con otras fechas', feed([event('a', '20261110', '20261113'), event('a', '20261111', '20261114')].join('\r\n'))],
    ['VEVENT sin cerrar', feed('BEGIN:VEVENT\r\nUID:a')],
  ])('rechaza el calendario entero: %s', (_, text) => {
    expect(parseAirbnbIcal(text).ok).toBe(false)
  })
})

describe('URL iCal', () => {
  it('solo https de Airbnb', () => {
    expect(isAirbnbIcalUrl('https://www.airbnb.com/calendar/ical/123.ics?s=abc')).toBe(true)
    expect(isAirbnbIcalUrl('https://www.airbnb.com.co/calendar/ical/123.ics?s=abc')).toBe(true)
    expect(isAirbnbIcalUrl('http://www.airbnb.com/calendar/ical/123.ics')).toBe(false)
    expect(isAirbnbIcalUrl('https://airbnb.com.evil.example/x.ics')).toBe(false)
    expect(isAirbnbIcalUrl('https://169.254.169.254/latest')).toBe(false)
    expect(isAirbnbIcalUrl('no es url')).toBe(false)
  })

  it('nombres de variables por apartamento', () => {
    expect(CASA_BLUE_CATALOG.map(u => icalEnvName(u.slug))).toEqual([
      'CASA_BLUE_ICAL_MAR_ADENTRO_1305', 'CASA_BLUE_ICAL_TORRES_DEL_LAGO_1303', 'CASA_BLUE_ICAL_CRESPO_1214',
      'CASA_BLUE_ICAL_CONQUISTADOR_1821', 'CASA_BLUE_ICAL_MARINA_DEL_REY_1104', 'CASA_BLUE_ICAL_PALMETTO_1001',
      'CASA_BLUE_ICAL_TOCAHAGUA_1208', 'CASA_BLUE_ICAL_TOCAHAGUA_708',
    ])
  })
})

describe('runCalendarSync', () => {
  const SECRET = 's=SECRETO-NO-DEBE-SALIR'
  const env = (over: Record<string, string | undefined> = {}) => ({
    [COVERAGE_ENV]: '365',
    ...Object.fromEntries(CASA_BLUE_CATALOG.map((u, i) => [icalEnvName(u.slug), `https://www.airbnb.com/calendar/ical/${i}.ics?${SECRET}`])),
    ...over,
  })

  function fakeDb(rpcResult: { data: unknown; error: unknown } = { data: 'run-1', error: null }) {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const inserts: Array<{ table: string; row: unknown }> = []
    const touched: string[] = []
    const db: WriteDb = {
      from: (table: string) => {
        touched.push(table)
        return { insert: async (row: unknown) => { inserts.push({ table, row }); return { error: null } } }
      },
      rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcResult },
    }
    return { db, rpcCalls, inserts, touched }
  }

  const fetchFeeds = (bodies: Record<number, string | { status: number }> = {}) => (async (input: RequestInfo | URL) => {
    const url = String(input)
    const i = Number(url.match(/ical\/(\d+)\.ics/)![1])
    const body = bodies[i] ?? feed(i === 0 ? event('r1@airbnb.com', '20261110', '20261113') : '')
    if (typeof body !== 'string') return new Response('nope', { status: body.status })
    return new Response(body, { status: 200 })
  }) as typeof fetch

  it('ocho calendarios bien leídos → una sola llamada atómica con cobertura y data_as_of', async () => {
    const { db, rpcCalls, inserts, touched } = fakeDb()
    const out = await runCalendarSync({ db, env: env(), fetch: fetchFeeds(), now: () => NOW })
    expect(out).toMatchObject({ ok: true, runId: 'run-1', coverage: { from: '2026-10-18', to: '2027-10-18' } })
    expect(rpcCalls).toHaveLength(1)
    const args = rpcCalls[0].args
    expect(rpcCalls[0].fn).toBe('record_calendar_sync')
    expect(args.p_data_as_of).toBe('2026-10-18T06:30:00.000Z')
    expect(args.p_property_ids).toEqual(CASA_BLUE_CATALOG.map(u => u.propertyId))
    expect(args.p_events).toEqual([{ property_id: CASA_BLUE_CATALOG[0].propertyId, uid: 'r1@airbnb.com', start: '2026-11-10', end: '2026-11-13', kind: 'reserved' }])
    // Nunca toca reservations; no hay inserts sueltos cuando sale bien.
    expect(touched).not.toContain('reservations')
    expect(inserts).toHaveLength(0)
    expect(JSON.stringify(out)).not.toContain('SECRETO')
  })

  it('es idempotente: el mismo calendario produce exactamente la misma carga', async () => {
    const a = fakeDb(); const b = fakeDb()
    await runCalendarSync({ db: a.db, env: env(), fetch: fetchFeeds(), now: () => NOW })
    await runCalendarSync({ db: b.db, env: env(), fetch: fetchFeeds(), now: () => NOW })
    expect(a.rpcCalls[0].args).toEqual(b.rpcCalls[0].args)
  })

  it.each([
    ['falta una URL', { env: env({ CASA_BLUE_ICAL_PALMETTO_1001: undefined }) }, /CASA_BLUE_ICAL_PALMETTO_1001/],
    ['URL que no es Airbnb', { env: env({ CASA_BLUE_ICAL_CRESPO_1214: 'https://evil.example/x.ics' }) }, /CASA_BLUE_ICAL_CRESPO_1214/],
    ['calendario repetido en dos unidades', { env: env({ CASA_BLUE_ICAL_CRESPO_1214: `https://www.airbnb.com/calendar/ical/0.ics?${SECRET}` }) }, /repetidos/],
    ['sin cobertura configurada', { env: env({ [COVERAGE_ENV]: undefined }) }, /CASA_BLUE_ICAL_COVERAGE_DAYS/],
    ['un calendario caído', { fetch: fetchFeeds({ 3: { status: 503 } }) }, /conquistador-1821 \(HTTP 503\)/],
    ['un calendario incompleto', { fetch: fetchFeeds({ 5: 'BEGIN:VCALENDAR\r\nPRODID:Airbnb' }) }, /palmetto-1001/],
  ])('%s → corrida fallida, sin certificar ni tocar eventos', async (_, over, message) => {
    const { db, rpcCalls, inserts } = fakeDb()
    const out = await runCalendarSync({ db, env: env(), fetch: fetchFeeds(), now: () => NOW, ...over })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toMatch(message)
    expect(rpcCalls).toHaveLength(0)
    expect(inserts).toEqual([{ table: 'calendar_sync_runs', row: expect.objectContaining({ status: 'failed', verified: false }) }])
    expect(JSON.stringify(inserts)).not.toContain('SECRETO')
  })

  it('un error de red con la URL en el mensaje no la filtra', async () => {
    const { db, inserts } = fakeDb()
    const leaky = (async (input: RequestInfo | URL) => { throw new TypeError(`fetch failed for ${String(input)}`) }) as typeof fetch
    const out = await runCalendarSync({ db, env: env(), fetch: leaky, now: () => NOW })
    expect(JSON.stringify(out) + JSON.stringify(inserts)).not.toContain('SECRETO')
    expect(!out.ok && out.error).toMatch(/error de red/)
  })

  it('si la base rechaza la transacción, no hay corrida verificada', async () => {
    const { db, inserts } = fakeDb({ data: null, error: { code: 'P0001' } })
    const out = await runCalendarSync({ db, env: env(), fetch: fetchFeeds(), now: () => NOW })
    expect(out).toEqual({ ok: false, error: 'no se pudo guardar la corrida (P0001)' })
    expect(inserts[0]).toMatchObject({ table: 'calendar_sync_runs', row: { status: 'failed', verified: false } })
  })
})
