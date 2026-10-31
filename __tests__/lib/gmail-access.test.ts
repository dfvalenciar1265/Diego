import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ member: vi.fn(), run: vi.fn(), db: vi.fn(), sessionDb: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: mocks.member }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/gmail-reconciliation/runner', () => ({ runGmailSync: mocks.run, gmailSyncDb: mocks.db }))
vi.mock('@/lib/gmail-reconciliation/status', () => ({ readGmailStatus: mocks.status }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.sessionDb }))
import { GET, POST } from '@/app/api/gmail-sync/route'
import { syncGmail, getGmailStatus, reviewGmailIssue } from '@/actions/gmail'

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'dummy-synthetic-cron')
  mocks.member.mockResolvedValue(null)
  mocks.run.mockResolvedValue({ ok: true, state: 'complete' })
})
const request = (method: string, auth?: string, query = '') => new NextRequest(`https://example.test/api/gmail-sync${query}`, {
  method, headers: auth ? { authorization: auth } : {},
})
afterEach(() => vi.unstubAllEnvs())
describe('cron y acciones de conciliación con permiso de admin activo', () => {
  it('un GET no autorizado nunca ejecuta el importador', async () => {
    expect((await GET(request('GET'))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('un secreto ausente no autoriza Bearer undefined', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('GET', 'Bearer undefined'))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('el cron válido registra origen cron y una importación parcial responde 207', async () => {
    mocks.run.mockResolvedValue({ ok: false, state: 'partial' })
    expect((await GET(request('GET', 'Bearer dummy-synthetic-cron'))).status).toBe(207)
    expect(mocks.run).toHaveBeenCalledWith({ via: 'cron', actorId: undefined, days: undefined }, expect.anything())
  })
  it.each([null, { id: 'synthetic-cleaner', role: 'cleaning' }, { id: 'synthetic-host', role: 'anfitrion' }])('deniega la importación y consulta manual a %j', async member => {
    mocks.member.mockResolvedValue(member)
    expect((await POST(request('POST'))).status).toBe(403)
    expect((await syncGmail()).ok).toBe(false)
    await expect(getGmailStatus()).rejects.toThrow('Solo administradores activos')
    expect((await reviewGmailIssue('00000000-0000-0000-0000-00000000a101', 1, 'Nota sintética')).success).toBe(false)
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled()
  })
  it('el botón usa el servicio directamente y atribuye el admin verificado', async () => {
    mocks.member.mockResolvedValue({ id: 'synthetic-admin', role: 'admin' })
    expect((await syncGmail()).ok).toBe(true)
    expect(mocks.run).toHaveBeenCalledWith({ via: 'manual', actorId: 'synthetic-admin' }, expect.anything())
  })
  it.each(['0', '1826', '1.5', 'NaN'])('rechaza un alcance inválido %s', async days => {
    expect((await GET(request('GET', 'Bearer dummy-synthetic-cron', `?days=${days}`))).status).toBe(400)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('la revisión concurrente muestra conflicto y conserva el estado actual', async () => {
    mocks.member.mockResolvedValue({ id: 'synthetic-admin', role: 'admin' })
    const rpc = vi.fn().mockResolvedValue({ error: { code: '40001' } }); mocks.sessionDb.mockResolvedValue({ rpc })
    const result = await reviewGmailIssue('00000000-0000-0000-0000-00000000a101', 2, 'Constancia sintética')
    expect(result.success).toBe(false); expect(result.error).toContain('cambió')
    expect(rpc).toHaveBeenCalledWith('gmail_sync_review', { p_id: '00000000-0000-0000-0000-00000000a101', p_version: 2, p_note: 'Constancia sintética' })
  })
})
