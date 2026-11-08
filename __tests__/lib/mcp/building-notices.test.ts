import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer, AuthInfo, CallToolResult } from '@modelcontextprotocol/server'
import type { Db } from '@/lib/gpt-api/db'
const mocks = vi.hoisted(() => ({ db: undefined as Db | undefined }))
vi.mock('@/lib/gpt-api/db', () => ({ serviceDb: () => mocks.db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { fakeDb } from '../../helpers/fake-db'
import { buildingIds as ids, buildingView, buildingRecipient, buildingNotice } from '../../helpers/building-notices'
import { noticeSnapshot } from '@/lib/building-notices'
import { registerTools } from '@/lib/mcp/tools'

type Handler = (input: Record<string, unknown>, ctx: { http?: { authInfo?: AuthInfo } }) => Promise<CallToolResult>
const handlers = new Map<string, Handler>()
registerTools({ registerTool: (name: string, _config: unknown, fn: Handler) => handlers.set(name, fn) } as unknown as McpServer)
const ctx = { http: { authInfo: { token: 'token-sintetico-sin-validez', clientId: 'cliente-sintetico', scopes: [],
  extra: { memberId: ids.admin, memberName: 'Admin Sintético' } } as AuthInfo } }
function setup(role = 'admin') {
  const v = buildingView(), rpc = vi.fn().mockResolvedValue({ data: { ok: true, data: buildingNotice(v) }, error: null })
  mocks.db = fakeDb({ team_members: [{ id: ids.admin, active: true, role }], reservations: [{ ...v.reservation }],
    properties: [{ id: ids.property, name: v.property, active: true }], building_recipients: [{ ...buildingRecipient() }],
    building_notices: [], building_notice_history: [], tasks: [] }, { rpc })
  return { v, rpc }
}
beforeEach(() => vi.clearAllMocks())
describe('adaptador MCP de avisos', () => {
  it('consulta y previsualiza por UUID sin persistir ni enviar', async () => {
    const { rpc } = setup()
    const listed = await handlers.get('list_building_notices')!({ reservation_id: ids.reservation }, ctx)
    expect(listed.isError).not.toBe(true)
    expect(listed.structuredContent).toMatchObject({ arrivals: [{ reservation: { id: ids.reservation, guests: 2 } }] })
    const preview = await handlers.get('preview_building_notice')!({ reservation_id: ids.reservation, recipient_id: ids.recipient }, ctx)
    expect(preview.structuredContent).toMatchObject({ snapshot: { template_version: 1 }, message: { emailSubject: expect.any(String) } })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['cleaning','maintenance','anfitrion'])('rechaza %s antes de cualquier escritura RPC', async role => {
    const { rpc } = setup(role)
    const result = await handlers.get('prepare_building_notice')!({}, ctx)
    expect(result.isError).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('deriva el actor del OAuth y traduce conflictos sin convertirlos en éxito', async () => {
    const { v, rpc } = setup()
    rpc.mockResolvedValue({ data: { ok: false, conflict: true, error: 'Cambió el aviso.', current: { version: 2 } }, error: null })
    const result = await handlers.get('prepare_building_notice')!({ reservation_id: ids.reservation, recipient_id: ids.recipient,
      snapshot: noticeSnapshot(v, v.recipients[0]), request_key: 'mcp-sintetico' }, ctx)
    expect(rpc).toHaveBeenCalledWith('manage_building_notice', expect.objectContaining({ p_actor_id: ids.admin, p_source: 'mcp', p_operation: 'prepare' }))
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Cambió el aviso.\nEstado actual: {"version":2}' }])
  })
  it('no permite ausencia de identidad ni actor suministrado en el input', async () => {
    const { rpc } = setup()
    expect((await handlers.get('list_building_notices')!({}, {})).isError).toBe(true)
    const input = { notice_id: ids.notice, expected_version: 1, request_key: 'suplantacion-sintetica',
      action: 'sent', occurred_at: '2026-11-08T08:00:00-05:00', evidence: 'Referencia Sintética del envío',
      evidence_kind: 'operator_confirmation', confirmed: true, actor_id: ids.admin }
    expect((await handlers.get('record_building_notice')!(input, ctx)).isError).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})
