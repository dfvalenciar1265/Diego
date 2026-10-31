import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb } from '../helpers/fake-db'
import { checkout } from '../helpers/checkout'
const mocks = vi.hoisted(() => ({ db: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.db }))
import { getTodayCheckOuts } from '@/actions/dashboard'
beforeEach(() => vi.clearAllMocks())
describe('salidas y limpieza de Inicio', () => {
  it('lee solo salidas confirmadas del día y muestra estado y responsable sin costos', async () => {
    const co = checkout()
    const reservation = { ...co.stay, id: co.id, property_id: co.property_id, status: 'confirmed',
      guest_name: co.guest_name, guests: 2, property: { name: co.property_name }, time_events: [],
      tasks: [{ ...co.cleaning.task, type: 'cleaning', notes: '11:00|Nota Sintética', assignee: { name: 'Ana Sintética' }, cost: 999 }] }
    mocks.db.mockResolvedValue(fakeDb({ reservations: [reservation, { ...reservation, id: 'cancelled', status: 'cancelled' },
      { ...reservation, id: 'other-day', check_out: '2027-02-14' }] }))
    const result = await getTodayCheckOuts(co.stay.check_out)
    expect(result).toHaveLength(1)
    expect(result[0].cleaning).toMatchObject({ review: null, task: { status: 'pending', assignee_name: 'Ana Sintética' } })
    expect(result[0].cleaning.task).not.toHaveProperty('cost')
    expect(result[0].timing.effective_time).toBe('11:00')
  })
  it('conserva duplicados pero no elige una tarea arbitraria para editar o limpiar', async () => {
    const co = checkout()
    mocks.db.mockResolvedValue(fakeDb({ reservations: [{ ...co.stay, id: co.id, property_id: co.property_id, status: 'confirmed',
      time_events: [], property: null, tasks: [
        { ...co.cleaning.task, type: 'cleaning', notes: '11:00|' },
        { ...co.cleaning.task, id: 'duplicate-synthetic', type: 'cleaning', notes: '13:00|' },
      ] }] }))
    const [result] = await getTodayCheckOuts(co.stay.check_out)
    expect(result.cleaning.task).toBeNull()
    expect(result.cleaning.review).toMatch(/varias tareas/)
    expect(result.cleaning_task_id).toBeNull()
  })
})
