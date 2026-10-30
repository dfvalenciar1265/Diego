import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb } from '../helpers/fake-db'
import { preparationArrival, preparationState } from '../helpers/preparation'
const mocks = vi.hoisted(() => ({ member: vi.fn(), client: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: mocks.member }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }))
import { saveArrivalPreparation } from '@/actions/preparation'
const r = preparationArrival()
const input = { reservation_id: r.id, step: 'cleaning' as const, confirmed: true, expected_version: 0,
  request_key: 'action-synthetic', stay_check_in: r.check_in, stay_check_out: r.check_out }
beforeEach(() => vi.clearAllMocks())
describe('permisos de la acción de preparación', () => {
  it('sin sesión activa no crea cliente ni intenta escribir', async () => {
    mocks.member.mockResolvedValue(null)
    expect(await saveArrivalPreparation(input)).toMatchObject({ success: false })
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('limpieza no puede confirmar listo aunque fabrique la llamada', async () => {
    mocks.member.mockResolvedValue({ id: 'cleaner', role: 'cleaning' })
    expect(await saveArrivalPreparation({ ...input, step: 'ready' })).toMatchObject({ success: false })
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('la identidad proviene de la sesión y solo refresca tras confirmación real', async () => {
    const id = '00000000-0000-0000-0000-0000000000d1'
    mocks.member.mockResolvedValue({ id, role: 'admin' })
    const rpc = vi.fn(() => ({ data: { ok: true, data: preparationState({ version: 1 }) }, error: null }))
    mocks.client.mockResolvedValue(fakeDb({}, { rpc }))
    expect(await saveArrivalPreparation(input)).toMatchObject({ success: true })
    expect(rpc).toHaveBeenCalledWith('record_arrival_preparation', expect.objectContaining({ p_actor_id: id, p_source: 'app' }))
    expect(mocks.refresh).toHaveBeenCalledWith('/')
  })
  it('un conflicto se muestra con el estado actual sin refrescar ni sobreescribir', async () => {
    mocks.member.mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000d1', role: 'admin' })
    const current = preparationState({ version: 4 })
    mocks.client.mockResolvedValue(fakeDb({}, { rpc: () => ({ data: { ok: false, conflict: true, error: 'Cambió la preparación.', current }, error: null }) }))
    expect(await saveArrivalPreparation(input)).toMatchObject({ success: false, conflict: true, current })
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
