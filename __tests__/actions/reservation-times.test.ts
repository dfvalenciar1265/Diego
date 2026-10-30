import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb } from '../helpers/fake-db'
import { timingReservation as r, timeEvent } from '../helpers/timing'
const mocks = vi.hoisted(() => ({ member: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: mocks.member }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { saveReservationTime } from '@/actions/reservation-times'
import { updateTaskNotes } from '@/actions/tasks'
const input = { reservation_id: r.id, direction: 'checkin' as const, kind: 'estimate' as const, time: '09:00',
  expected_version: 0, request_key: 'synthetic-action', stay_check_in: r.check_in, stay_check_out: r.check_out }
beforeEach(() => vi.clearAllMocks())
describe('acciones de horarios y notas', () => {
  it.each([null, { id: 'c1', role: 'cleaning' }])('deniega guardar horarios a %j', async member => {
    mocks.member.mockResolvedValue(member)
    expect(await saveReservationTime(input)).toMatchObject({ success: false })
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('toma el autor de la sesión, nunca del formulario', async () => {
    mocks.member.mockResolvedValue({ id: 'd1', role: 'admin' })
    const rpc = vi.fn(() => ({ data: timeEvent(), error: null }))
    mocks.db.mockResolvedValue(fakeDb({}, { rpc }))
    expect(await saveReservationTime(input)).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('record_reservation_time', expect.objectContaining({ p_actor_id: 'd1', p_source: 'app' }))
  })
  it('guardar una nota mantiene la excepción vigente y no convierte la ETA en autorización', async () => {
    mocks.member.mockResolvedValue({ id: 'c1', role: 'cleaning' })
    const tables = { tasks: [{ id: 't1', notes: '13:00|Nota anterior', version: 1 }] }
    mocks.db.mockResolvedValue(fakeDb(tables))
    expect(await updateTaskNotes('t1', 'Nota sintética', { noteOnly: true })).toEqual({ success: true })
    expect(tables.tasks[0].notes).toBe('13:00|Nota sintética')
    expect(await updateTaskNotes('t1', '09:00|Intento de hora', { noteOnly: true })).toMatchObject({ success: false })
    expect(await updateTaskNotes('t1', '09:00|')).toMatchObject({ success: false })
  })
})
