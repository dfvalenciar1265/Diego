import { describe, expect, it, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { writeReservationTime, type TimeWrite } from '@/lib/reservation-time-writes'
import { setCheckinTimeTool, setCheckoutTimeTool, turnoversTool } from '@/lib/gpt-api/service'
import { fakeDb } from '../helpers/fake-db'
import { timingReservation as r, timeEvent as event } from '../helpers/timing'
const actor = { id: '00000000-0000-0000-0000-0000000000d1', via: 'mcp' as const }
const write: TimeWrite = { reservation_id: r.id, direction: 'checkin', kind: 'estimate', time: '09:00', expected_version: 0,
  request_key: 'synthetic-retry', stay_check_in: r.check_in, stay_check_out: r.check_out }
const properties = [{ id: r.property_id, name: 'Apartamento Sintético', active: true }]
const reservation = { ...r, guest_name: 'Huésped Sintético', guests: 2, notes: '', airbnb_code: 'HMSYNTH01', tasks: [{ id: 't1', type: 'preparation', notes: '', scheduled_for: '2027-02-09', status: 'pending' }] }

describe('escrituras y servicio con fake-db', () => {
  it('envía identidad, estancia, versión y clave al RPC atómico, sin escribir directamente notas', async () => {
    const rpc = vi.fn<(name: string, args: Record<string, unknown>) => { data: ReturnType<typeof event>; error: null }>(() => ({ data: event(), error: null }))
    const tables = { tasks: [{ id: 't1', notes: '15:00|Nota' }] }
    const result = await writeReservationTime(fakeDb(tables, { rpc }), write, actor)
    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('record_reservation_time', expect.objectContaining({ p_expected_version: 0,
      p_request_key: 'synthetic-retry', p_actor_id: actor.id, p_kind: 'estimate', p_stay_check_in: r.check_in }))
    expect(tables.tasks[0].notes).toBe('15:00|Nota')
  })
  it.each([['40001', 409], ['40P01', 409], ['42501', 403], ['22023', 400]])('propaga %s como %s sin fingir éxito', async (code, status) => {
    const db = fakeDb({}, { rpc: () => ({ data: null, error: { code, message: 'Error sintético' } }) })
    expect(await writeReservationTime(db, write, actor)).toMatchObject({ ok: false, status })
  })
  it.each([{ time: '25:00' }, { expected_version: -1 }, { kind: 'platform' }, { stay_check_in: '2027-02-30' }])('rechaza entrada inválida antes de llamar a la base: %j', async patch => {
    const rpc = vi.fn()
    expect((await writeReservationTime(fakeDb({}, { rpc }), { ...write, ...patch } as TimeWrite, actor)).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('list_turnovers expone por separado estándar, ETA y autorización', async () => {
    const result = await turnoversTool(fakeDb({ properties, reservations: [{ ...reservation, time_events: [event()] }] }), { date: r.check_in }, r.check_in)
    expect(result).toMatchObject({ ok: true, data: { checkins: [{ time: '15:00', time_source: 'default',
      timing: { estimate: { time: '09:00' }, authorization: null, standard: { time: '15:00' } } }] } })
  })
  it('set_checkin_time conserva el contrato previo de autorización y agrega ETA explícita', async () => {
    const row = { ...reservation, time_events: [] as ReturnType<typeof event>[] }
    const rpc = vi.fn((_name: string, args: Record<string, unknown>) => {
      const saved = event({ kind: args.p_kind as 'estimate' | 'authorization', source: 'mcp', time: args.p_time as string, version: row.time_events.length + 1 })
      row.time_events.push(saved)
      return { data: saved, error: null }
    })
    const db = fakeDb({ properties, reservations: [row] }, { rpc })
    const body = { property: 'Apartamento Sintético', time: '09:00', date: r.check_in, request_key: 'same-key', expected_version: 0 }
    expect(await setCheckinTimeTool(db, { ...body, kind: 'estimate' }, r.check_in, actor)).toMatchObject({ ok: true, data: { time: '15:00' } })
    expect(await setCheckinTimeTool(db, body, r.check_in, actor)).toMatchObject({ ok: true, data: { time: '09:00', time_source: 'app' } })
    expect(rpc.mock.calls[0][1].p_request_key).toBe('same-key')
  })
  it('un conflicto devuelve el estado leído de nuevo, no el estado anterior al intento', async () => {
    const row = { ...reservation, time_events: [] as ReturnType<typeof event>[] }
    const db = fakeDb({ properties, reservations: [row] }, { rpc: () => {
      row.time_events.push(event({ kind: 'authorization', time: '13:00' }))
      return { data: null, error: { code: '40001', message: 'Conflicto sintético' } }
    } })
    expect(await setCheckinTimeTool(db, { property: 'Apartamento Sintético', time: '12:00', date: r.check_in }, r.check_in, actor))
      .toMatchObject({ ok: false, status: 409, current: { effective_time: '13:00', version: 1 } })
  })
  it('sin identidad MCP o con reserva cancelada no escribe', async () => {
    const rpc = vi.fn()
    const db = fakeDb({ properties, reservations: [{ ...reservation, status: 'cancelled' }] }, { rpc })
    const body = { property: 'Apartamento Sintético', time: '12:00', date: r.check_out }
    expect(await setCheckoutTimeTool(db, body, r.check_in)).toMatchObject({ ok: false, status: 403 })
    expect(await setCheckoutTimeTool(db, body, r.check_in, actor)).toMatchObject({ ok: false, status: 404 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('dos reservas en un apartamento exigen identificar la estancia exacta', async () => {
    const rpc = vi.fn<(name: string, args: Record<string, unknown>) => { data: ReturnType<typeof event>; error: null }>(() => ({ data: event(), error: null }))
    const db = fakeDb({ properties, reservations: [reservation, { ...reservation, id: '00000000-0000-0000-0000-000000007002' }] }, { rpc })
    const body = { property: 'Apartamento Sintético', time: '09:00', date: r.check_in, kind: 'estimate' }
    expect(await setCheckinTimeTool(db, body, r.check_in, actor)).toMatchObject({ ok: false, status: 409 })
    expect(await setCheckinTimeTool(db, { ...body, reservation_id: r.id }, r.check_in, actor)).toMatchObject({ ok: true })
  })
})
