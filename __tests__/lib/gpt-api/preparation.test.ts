import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { fakeDb } from '../../helpers/fake-db'
import { preparationArrival, preparationState } from '../../helpers/preparation'
import { preparationArrivals, preparationViews, writePreparation, type PreparationWrite } from '@/lib/gpt-api/preparation'
import { setArrivalPreparationTool } from '@/lib/gpt-api/service'

const arrival = preparationArrival()
const actor = { id: '00000000-0000-0000-0000-0000000000d1', via: 'app' as const }
const write: PreparationWrite = { reservation_id: arrival.id, step: 'cleaning', confirmed: true, expected_version: 0,
  request_key: 'request-synthetic', stay_check_in: arrival.check_in, stay_check_out: arrival.check_out }
afterEach(() => vi.useRealTimers())

describe('lectura segura de preparación', () => {
  it('una tarea antigua terminada no confirma la limpieza ni listo de la llegada', async () => {
    const r = preparationArrival({ tasks: [{ ...arrival.tasks[0], status: 'done' }] })
    const db = fakeDb({ reservations: [r as never] })
    const views = await preparationViews(db, [r], r.check_in)
    expect(views[r.id]).toMatchObject({ available: true, can_confirm: true, state: null })
    expect(views[r.id].blockers).toContain('Falta confirmar la limpieza para esta llegada.')
  })

  it('conserva tareas duplicadas y trae cada reserva una vez, incluidas las de mañana sin tarea', async () => {
    const r = preparationArrival({ tasks: [arrival.tasks[0], { ...arrival.tasks[0], id: 'duplicate', notes: 'Otra nota Sintética' }] })
    const tomorrow = { ...preparationArrival(), id: 'tomorrow', check_in: '2027-02-11', tasks: [] }
    const rows = [r, tomorrow, { ...tomorrow, id: 'cancelled', status: 'cancelled' }, { ...tomorrow, id: 'future', check_in: '2027-02-12' }]
    const result = await preparationArrivals(fakeDb({ reservations: rows as never }), '2027-02-10')
    expect(result.map(r => r.id)).toEqual([arrival.id, 'tomorrow'])
    expect(result[0].tasks).toHaveLength(2)
    expect(rows[0].tasks[1].notes).toBe('Otra nota Sintética')
    expect(result[1].tasks).toHaveLength(0)
  })

  it('pone las incidencias del apartamento junto a la llegada, excluye resueltas/preventivos y no expone costos', async () => {
    const db = fakeDb({ maintenance: [
      { id: 'urgent', property_id: arrival.property_id, title: 'Agua Sintética', priority: 'urgent', status: 'open', cost: 99000 },
      { id: 'normal', property_id: arrival.property_id, title: 'Cortina Sintética', priority: 'normal', status: 'in_progress', cost: 10000 },
      { id: 'other', property_id: 'other-property', priority: 'urgent', status: 'open' },
      { id: 'resolved', property_id: arrival.property_id, priority: 'urgent', status: 'resolved' },
      { id: 'preventive', property_id: arrival.property_id, priority: 'scheduled', status: 'open' },
    ], special_requests: [
      { id: 'crib', reservation_id: arrival.id, description: 'Cuna Sintética', status: 'notified', review_reason: null, amount: 50000 },
      { id: 'other-reservation', reservation_id: 'other', status: 'registered' },
      { id: 'cancelled', reservation_id: arrival.id, status: 'cancelled' },
    ] })
    const view = (await preparationViews(db, [arrival], arrival.check_in))[arrival.id]
    expect(view.issues.map(i => i.id)).toEqual(['urgent', 'normal'])
    expect(view.requests.map(q => q.id)).toEqual(['crib'])
    expect(view.blockers).toContain('Hay incidencias urgentes abiertas.')
    expect(view.blockers).toContain('Hay solicitudes especiales pendientes o por revisar.')
    expect(JSON.stringify(view)).not.toMatch(/cost|amount|99000|50000/)
  })

  it.each(['arrival_preparations', 'arrival_preparation_history', 'maintenance', 'special_requests'])('una lectura fallida de %s bloquea confirmar', async table => {
    const db = fakeDb({}, { failSelectOnce: table })
    const view = (await preparationViews(db, [arrival], arrival.check_in))[arrival.id]
    expect(view).toMatchObject({ available: false, can_confirm: false })
    expect(view.error).toMatch(/No se pudo comprobar/)
  })

  it.each([{ check_in: '2027-02-11' }, { property_id: 'other' }, { status: 'cancelled' }])('no reutiliza confirmaciones de una estancia modificada: %j', async patch => {
    const r = { ...arrival, ...patch }
    const db = fakeDb({ arrival_preparations: [preparationState({ cleaned_at: '2027-02-09T15:00:00Z', checked_at: '2027-02-09T15:30:00Z', ready_at: '2027-02-09T16:00:00Z', version: 3 }) as never] })
    const view = (await preparationViews(db, [r], r.check_in))[r.id]
    expect(view.state).toMatchObject({ version: 3, cleaned_at: null, checked_at: null, ready_at: null })
    expect(view.state?.review_reason).toMatch(/otra estancia/)
  })

  it('calcula la ventana de confirmación en Bogotá aunque UTC ya sea mañana', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T03:30:00Z'))
    const today = { ...arrival, check_in: '2026-10-30' }
    const future = { ...arrival, id: 'future', check_in: '2026-11-01' }
    const views = await preparationViews(fakeDb({}), [today, future])
    expect(views[today.id].can_confirm).toBe(true)
    expect(views[future.id].can_confirm).toBe(false)
  })
})

describe('escritura común a app y MCP', () => {
  it('envía identidad confiable, versión, estancia y la misma clave para el reintento', async () => {
    const rpc = vi.fn(() => ({ data: { ok: true, data: preparationState({ version: 1 }), replayed: true }, error: null }))
    const db = fakeDb({}, { rpc })
    expect((await writePreparation(db, write, actor)).ok).toBe(true)
    expect((await writePreparation(db, write, actor)).ok).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(rpc.mock.calls[0]).toEqual(['record_arrival_preparation', expect.objectContaining({
      p_actor_id: actor.id, p_source: 'app', p_step: 'cleaning', p_expected_version: 0,
      p_request_key: write.request_key, p_stay_check_in: arrival.check_in, p_stay_check_out: arrival.check_out,
    })])
  })

  it('un conflicto devuelve el estado actual y no reintenta por su cuenta', async () => {
    const current = preparationState({ version: 2 })
    const rpc = vi.fn(() => ({ data: { ok: false, conflict: true, error: 'La preparación cambió.', current }, error: null }))
    const result = await writePreparation(fakeDb({}, { rpc }), write, actor)
    expect(result).toMatchObject({ ok: false, status: 409, current })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each([{ step: 'invalid' }, { expected_version: -1 }, { stay_check_in: '2027-02-31' }, { request_key: '' }, { confirmed: false }, { confirmed: 'sí' }])('rechaza entrada inválida antes de llamar SQL: %j', async patch => {
    const rpc = vi.fn()
    const result = await writePreparation(fakeDb({}, { rpc }), { ...write, ...patch } as PreparationWrite, actor)
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([['42501', 403], ['40001', 409], ['40P01', 409]])('traduce %s sin mostrar detalles internos', async (code, status) => {
    const rpc = () => ({ data: null, error: { code, message: 'Detalle interno Sintético' } })
    expect(await writePreparation(fakeDb({}, { rpc }), write, actor)).toMatchObject({ ok: false, status })
  })

  it('resultado vacío no equivale a una confirmación guardada', async () => {
    expect(await writePreparation(fakeDb({}), write, actor)).toMatchObject({ ok: false, status: 500 })
  })

  it('el servicio MCP exige identidad y usa la misma escritura con su fuente', async () => {
    const rpc = vi.fn(() => ({ data: { ok: true, data: preparationState({ version: 1 }) }, error: null }))
    const db = fakeDb({}, { rpc })
    expect(await setArrivalPreparationTool(db, write, null)).toMatchObject({ ok: false, status: 403 })
    expect(rpc).not.toHaveBeenCalled()
    expect((await setArrivalPreparationTool(db, write, { ...actor, via: 'mcp' })).ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('record_arrival_preparation', expect.objectContaining({ p_source: 'mcp', p_actor_id: actor.id }))
  })
})
