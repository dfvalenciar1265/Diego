import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ member: vi.fn(), client: vi.fn(), read: vi.fn(), write: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: mocks.member }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/gpt-api/service', () => ({ listBuildingNoticesTool: mocks.read, writeBuildingNoticeTool: mocks.write }))
import { getBuildingNotices, manageBuildingNotice } from '@/actions/building-notices'
import { setBuildingNotified } from '@/actions/tasks'
import { buildingIds as ids } from '../helpers/building-notices'

beforeEach(() => { vi.clearAllMocks(); mocks.client.mockResolvedValue({ synthetic: true }); mocks.member.mockResolvedValue({ id: ids.admin, role: 'admin', active: true }) })
describe('acciones de avisos', () => {
  it('deriva la identidad de la sesión para las lecturas y escrituras', async () => {
    mocks.read.mockResolvedValue({ ok: true, data: {} }); mocks.write.mockResolvedValue({ ok: true, data: {} })
    await getBuildingNotices(ids.reservation)
    expect(mocks.read).toHaveBeenCalledWith({ synthetic: true }, { reservation_id: ids.reservation }, { id: ids.admin, via: 'app' })
    await manageBuildingNotice('record', { actor_id: 'identidad-falsa' })
    expect(mocks.write).toHaveBeenCalledWith({ synthetic: true }, 'record', { actor_id: 'identidad-falsa' }, { id: ids.admin, via: 'app' })
    expect(mocks.revalidate).toHaveBeenCalledWith('/')
  })
  it('sin sesión transmite actor nulo y no revalida un error como si fuera éxito', async () => {
    mocks.member.mockResolvedValue(null); mocks.write.mockResolvedValue({ ok: false, status: 403 })
    await manageBuildingNotice('prepare', {})
    expect(mocks.write).toHaveBeenCalledWith({ synthetic: true }, 'prepare', {}, null)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each([null, { id: ids.admin, role: 'cleaning' }, { id: ids.admin, role: 'admin' }])('el acceso antiguo nunca modifica la marca heredada (%j)', async member => {
    mocks.member.mockResolvedValue(member)
    expect((await setBuildingNotified('tarea-sintetica', true)).success).toBe(false)
    expect((await setBuildingNotified('tarea-sintetica', false)).success).toBe(false)
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
