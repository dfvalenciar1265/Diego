import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, type Row } from '../helpers/fake-db'
import { buildingIds as ids, buildingView, buildingNotice, buildingRecipient } from '../helpers/building-notices'
import { bogotaDateTimeLocal, noticeBlockers, noticeDraftLink, noticeSnapshot, noticeMessage } from '@/lib/building-notices'
import { listBuildingNoticesTool, previewBuildingNoticeTool, writeBuildingNoticeTool } from '@/lib/gpt-api/service'
const actor = { id: ids.admin, via: 'mcp' as const }
function tables(): Record<string, Row[]> {
  const view = buildingView()
  return { team_members: [{ id: ids.admin, role: 'admin', active: true }], reservations: [{ ...view.reservation, notes: 'Nota privada Sintética' }],
    properties: [{ id: ids.property, name: view.property, active: true }], building_recipients: [{ ...buildingRecipient() }],
    building_notices: [], building_notice_observations: [], building_notice_history: [], tasks: [] }
}
beforeEach(() => vi.useRealTimers())
describe('avisos a edificios, lecturas y contratos', () => {
  it('la plantilla versionada conserva año y huéspedes al cruzar diciembre y enero', () => {
    const view = buildingView()
    view.reservation.check_in = '2026-12-31'; view.reservation.check_out = '2027-01-02'
    const snapshot = noticeSnapshot(view, view.recipients[0]), message = noticeMessage(snapshot)
    expect(snapshot.template_version).toBe(1)
    expect(message.whatsappText).toContain('31 de diciembre de 2026 a 2 de enero de 2027 (2 noches)')
    expect(message.whatsappText).toContain('Huéspedes: 2')
    expect(message.emailBody).toContain('N.º de huéspedes: 2')
  })
  it('previsualiza sin persistir, sin enlaces externos y con datos mínimos', async () => {
    const data = tables(), rpc = vi.fn()
    const before = JSON.stringify(data)
    const result = await previewBuildingNoticeTool(fakeDb(data, { rpc }), { reservation_id: ids.reservation, recipient_id: ids.recipient }, actor)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).toContain('Titular Sintético')
    expect(JSON.stringify(result)).not.toContain('Nota privada')
    expect(JSON.stringify(result)).not.toContain('mailto:')
    expect(rpc).not.toHaveBeenCalled()
    expect(JSON.stringify(data)).toBe(before)
  })
  it.each(['cleaning','maintenance','anfitrion'])('deniega lectura y escritura a %s también en servidor', async role => {
    const data = tables(); data.team_members[0].role = role
    const rpc = vi.fn(), db = fakeDb(data, { rpc })
    expect((await listBuildingNoticesTool(db, {}, actor)).status).toBe(403)
    expect((await writeBuildingNoticeTool(db, 'prepare', {}, actor)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('deniega sesión ausente e inactiva', async () => {
    const data = tables(); data.team_members[0].active = false
    expect((await listBuildingNoticesTool(fakeDb(data), {}, actor)).status).toBe(403)
    expect((await listBuildingNoticesTool(fakeDb(tables()), {}, null)).status).toBe(403)
  })
  it('filtra el día de Colombia aunque UTC ya sea mañana', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T02:00:00Z'))
    const data = tables(); data.reservations.push({ ...data.reservations[0], id: 'otra', check_in: '2026-11-09' })
    const result = await listBuildingNoticesTool(fakeDb(data), {}, actor)
    expect(result.ok && result.data.date).toBe('2026-11-08')
    expect(result.ok && result.data.arrivals.map(a => a.reservation.id)).toEqual([ids.reservation])
    expect(bogotaDateTimeLocal()).toBe('2026-11-08T21:00')
    vi.useRealTimers()
  })
  it('usa el UUID de apartamento y resuelve su nombre nuevo', async () => {
    const data = tables(); data.properties[0].name = 'Nuevo Nombre Sintético'
    const result = await previewBuildingNoticeTool(fakeDb(data), { reservation_id: ids.reservation, recipient_id: ids.recipient }, actor)
    expect(result.ok && 'snapshot' in result.data && result.data.snapshot.apartment).toBe('Nuevo Nombre Sintético')
  })
  it('conserva todas las marcas de tareas duplicadas y el historial de otro apartamento anterior', async () => {
    const data = tables()
    data.tasks = [1,2].map(n => ({ id: String(n), reservation_id: ids.reservation, type: 'preparation', building_notified_at: '2026-11-01T15:00:00Z' }))
    data.building_notice_history = [{ id: 'history', reservation_id: ids.reservation, property_id: 'apartamento-anterior', action: 'sent' }]
    const result = await listBuildingNoticesTool(fakeDb(data), { reservation_id: ids.reservation }, actor)
    expect(result.ok && result.data.arrivals[0].legacy_marks).toHaveLength(2)
    expect(result.ok && result.data.arrivals[0].history).toHaveLength(1)
  })
  it('muestra ausencia o ambigüedad de contactos sin elegir uno', async () => {
    const data = tables(); data.building_recipients = []
    const missing = await listBuildingNoticesTool(fakeDb(data), {}, actor, '2026-11-08')
    expect(missing.ok && missing.data.arrivals[0].recipients).toEqual([])
    data.building_recipients = [buildingRecipient(), buildingRecipient({ id: 'otra' })].map(r => ({ ...r }))
    const multiple = await listBuildingNoticesTool(fakeDb(data), {}, actor, '2026-11-08')
    expect(multiple.ok && multiple.data.arrivals[0].recipients).toHaveLength(2)
  })
  it('un fallo de lectura no se anuncia como cero avisos', async () => {
    const result = await listBuildingNoticesTool(fakeDb(tables(), { failSelectOnce: 'building_notices' }), {}, actor, '2026-11-08')
    expect(result).toMatchObject({ ok: false, status: 503 })
  })
  it.each(['2026-02-30','mañana','2026-11-09T00:00Z'])('valida fecha %s', async date => {
    expect((await listBuildingNoticesTool(fakeDb(tables()), { date }, actor)).status).toBe(400)
  })
})
describe('borradores y escrituras verificables', () => {
  it.each(['cancelled','blocked'])('impide enlace de una reserva %s', status => {
    const view = buildingView(); view.reservation.status = status; view.blockers = noticeBlockers(view)
    expect(noticeDraftLink(view, view.recipients[0], buildingNotice(view))).toBeNull()
  })
  it.each([null,0,-1,1.5])('bloquea huéspedes incompletos %s', guests => {
    const view = buildingView(); view.reservation.guests = guests
    expect(noticeBlockers(view)).toContain('Falta confirmar el número de huéspedes.')
  })
  it.each(['uncertain','sent','delivered','received'] as const)('no ofrece reenvío de %s', status => {
    const view = buildingView()
    expect(noticeDraftLink(view, view.recipients[0], buildingNotice(view, { status }))).toBeNull()
  })
  it('solo ofrece enlace al borrador verificado y vigente', () => {
    const view = buildingView(), n = buildingNotice(view)
    expect(noticeDraftLink(view, view.recipients[0], n)).toMatch(/^mailto:porter-sintetico@example.test\?/)
    expect(noticeDraftLink(view, buildingRecipient({ verified_at: null }), n)).toBeNull()
    expect(noticeDraftLink(view, view.recipients[0], { ...n, review_reason: 'Revisar' })).toBeNull()
    view.reservation.check_out = '2026-11-11'
    expect(noticeDraftLink(view, view.recipients[0], n)).toBeNull()
  })
  it('pasa identidad y versión al RPC y conserva una clave estable para reintento', async () => {
    const data = tables(), view = buildingView(), rpc = vi.fn().mockReturnValue({ data: { ok: true, data: buildingNotice() }, error: null })
    const body = { reservation_id: ids.reservation, recipient_id: ids.recipient, snapshot: noticeSnapshot(view, view.recipients[0]), request_key: 'same-key' }
    const db = fakeDb(data, { rpc })
    expect((await writeBuildingNoticeTool(db, 'prepare', body, actor)).ok).toBe(true)
    expect((await writeBuildingNoticeTool(db, 'prepare', body, actor)).ok).toBe(true)
    expect(rpc).toHaveBeenNthCalledWith(2, 'manage_building_notice', { p_operation: 'prepare', p_input: body, p_source: 'mcp', p_actor_id: ids.admin })
  })
  it('propaga conflicto con estado actual', async () => {
    const rpc = () => ({ data: { ok: false, conflict: true, error: 'El aviso cambió.', current: { version: 2 } }, error: null })
    const result = await writeBuildingNoticeTool(fakeDb(tables(), { rpc }), 'verify_recipient', { recipient_id: ids.recipient, expected_version: 0, request_key: 'verify', evidence: 'Revisión Sintética' }, actor)
    expect(result).toEqual({ ok: false, status: 409, error: 'El aviso cambió.', current: { version: 2 } })
  })
  it('un error de persistencia produce resultado incierto, no éxito', async () => {
    const rpc = () => ({ data: null, error: { code: '08006' } })
    const result = await writeBuildingNoticeTool(fakeDb(tables(), { rpc }), 'verify_recipient', { recipient_id: ids.recipient, expected_version: 0, request_key: 'verify', evidence: 'Revisión Sintética' }, actor)
    expect(result).toMatchObject({ ok: false, status: 503 })
    expect(!result.ok && result.error).toContain('incierto')
  })
  it('rechaza registrar un envío sin evidencia ni confirmación y campos ajenos al aviso', async () => {
    const rpc = vi.fn(), db = fakeDb(tables(), { rpc })
    expect((await writeBuildingNoticeTool(db, 'record', { notice_id: ids.notice, action: 'sent' }, actor)).status).toBe(400)
    expect((await writeBuildingNoticeTool(db, 'verify_recipient', { recipient_id: ids.recipient, expected_version: 0, request_key: 'v', evidence: 'Revisión Sintética', extra: 'ajeno' }, actor)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})


describe('enlace directo sin efectos',()=>{
 it('construye propuesta verificada sin exigir notice preparado',async()=>{
  const {directBuildingDraftLink}=await import('@/lib/building-notices')
  const v=buildingView();expect(directBuildingDraftLink(v,v.recipients[0])).toMatch(/^mailto:/);expect(v.notices).toEqual([])
 })
 it('bloquea intento incierto, evidencia, cambios pendientes, contactos inválidos y marcas previas',async()=>{
  const {directBuildingDraftLink}=await import('@/lib/building-notices')
  for(const status of ['uncertain','sent','delivered','received'] as const){const v=buildingView();v.notices=[buildingNotice(v,{status})];expect(directBuildingDraftLink(v,v.recipients[0])).toBeNull()}
  const v=buildingView();v.notices=[buildingNotice(v,{review_reason:'Revisar cambio'})];expect(directBuildingDraftLink(v,v.recipients[0])).toBeNull()
  for(const address of ['a@example.test?bcc=other@example.test','a@example.test\r\nBcc:other@example.test']){const v=buildingView({recipients:[buildingRecipient({address})]});expect(directBuildingDraftLink(v,v.recipients[0])).toBeNull()}
  const old=buildingView({legacy_marks:[{task_id:'synthetic',at:'2026-11-01T00:00:00Z'}]});expect(directBuildingDraftLink(old,old.recipients[0])).toBeNull()
 })
})
