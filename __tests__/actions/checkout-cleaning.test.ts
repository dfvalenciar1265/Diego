import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ member: vi.fn(), db: vi.fn(), advance: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: mocks.member }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.db }))
vi.mock('@/lib/gpt-api/checkout-cleaning', () => ({ advanceCheckoutCleaning: mocks.advance }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { saveCheckoutCleaning } from '@/actions/checkout-cleaning'
import { checkout, cleanerId } from '../helpers/checkout'
const co = checkout()
const input = { reservation_id: co.id, task_id: co.cleaning_task_id!, property_id: co.property_id,
  stay_check_in: co.stay.check_in, stay_check_out: co.stay.check_out, assigned_to: cleanerId, action: 'start' as const }
beforeEach(() => vi.clearAllMocks())
describe('permiso de la acción de limpieza', () => {
  it.each([null, { id: cleanerId, role: 'maintenance' }])('rechaza una sesión sin permiso: %j', async member => {
    mocks.member.mockResolvedValue(member)
    expect((await saveCheckoutCleaning(input)).success).toBe(false)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('usa la identidad de sesión y actualiza Inicio y Limpieza solo tras confirmar el servidor', async () => {
    const member = { id: cleanerId, role: 'cleaning' }
    mocks.member.mockResolvedValue(member); mocks.db.mockResolvedValue({}); mocks.advance.mockResolvedValue({ success: true })
    expect((await saveCheckoutCleaning(input)).success).toBe(true)
    expect(mocks.advance).toHaveBeenCalledWith({}, input, member)
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual(['/', '/cleaning', '/tasks'])
  })
})
