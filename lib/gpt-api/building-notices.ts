import { z } from 'zod'
import type { Db } from './db'
import type { Actor } from './followups'
import type { ServiceResult } from './service'
import { isUuid } from './validate'
import { isIsoDate, todayInBogota } from './dates'
import { sameSnapshot, currentBuildingObservation, noticeBlockers, noticeMessage, noticeSnapshot, type BuildingNotice, type BuildingNoticeEvent,
  type BuildingNoticeObservation, type BuildingNoticeView, type BuildingRecipient } from '@/lib/building-notices'

const key = z.string().trim().min(1).max(200)
const evidence = z.string().trim().min(10).max(500)
const uuid = z.string().uuid()
const version = z.number().int().nonnegative()
export const verifyBuildingRecipientSchema = z.object({ recipient_id: uuid, expected_version: version,
  request_key: key, evidence }).strict()
export const prepareBuildingNoticeSchema = z.object({ reservation_id: uuid, recipient_id: uuid,
  snapshot: z.object({ template_version: z.literal(1), property_id: uuid, apartment: z.string(), guest_name: z.string(), guests: z.number().int().nullable(),
    check_in: z.string(), check_out: z.string(), recipient_id: uuid, channel: z.enum(['whatsapp', 'email']),
    address: z.string(), recipient_version: version }).strict(), request_key: key,
  review_confirmation: evidence.optional() }).strict()
export const recordBuildingNoticeSchema = z.object({ notice_id: uuid, expected_version: version,
  request_key: key, action: z.enum(['uncertain', 'sent', 'delivered', 'received', 'reviewed']),
  occurred_at: z.string().datetime({ offset: true }), evidence,
  evidence_kind: z.enum(['uncertain_result', 'operator_confirmation', 'message_reference', 'delivery_receipt', 'recipient_acknowledgment', 'review']),
  confirmed: z.literal(true) }).strict()

export const historicalBuildingNoticeSchema = z.object({ reservation_id: uuid, recipient_id: uuid,
  snapshot: prepareBuildingNoticeSchema.shape.snapshot, expected_version: z.literal(0), request_key: key,
  status: z.enum(['sent', 'delivered', 'received']), occurred_at: z.string().datetime({ offset: true }),
  evidence, reference: z.string().trim().min(1).max(200), confirmed: z.literal(true) }).strict()

async function isAdmin(db: Db, actor: Actor | null): Promise<boolean> {
  if (!actor || !isUuid(actor.id)) return false
  const { data, error } = await db.from('team_members').select('id,role,active').eq('id', actor.id).maybeSingle()
  return !error && data?.active === true && data.role === 'admin'
}
const denied = (): ServiceResult<never> => ({ ok: false, status: 403, error: 'Se requiere un administrador activo.' })
const unavailable = (): ServiceResult<never> => ({ ok: false, status: 503, error: 'No se pudieron consultar los avisos. Actualiza antes de confirmar cualquier envío.' })

/** Solo datos mínimos y marcas anteriores, también cuando faltan o se repiten tareas. */
export async function listBuildingNoticesTool(db: Db, query: { date?: string; reservation_id?: string; property_id?: string },
  actor: Actor | null, today = todayInBogota()): Promise<ServiceResult<{ date: string; arrivals: BuildingNoticeView[] }>> {
  if (!await isAdmin(db, actor)) return denied()
  const date = query.date ?? today
  if (!isIsoDate(date) || (query.reservation_id && !isUuid(query.reservation_id)) || (query.property_id && !isUuid(query.property_id))) {
    return { ok: false, status: 400, error: 'Indica una fecha AAAA-MM-DD y los identificadores exactos de reserva o apartamento.' }
  }
  let select = db.from('reservations').select('id,property_id,guest_name,guests,check_in,check_out,status').order('check_in').limit(201)
  select = query.reservation_id ? select.eq('id', query.reservation_id) : select.eq('check_in', date)
  if (query.property_id) select = select.eq('property_id', query.property_id)
  const reservations = await select
  if (reservations.error) return unavailable()
  if ((reservations.data?.length ?? 0) > 200) return { ok: false, status: 400, error: 'Hay más de 200 llegadas. Consulta por apartamento o reserva.' }
  const rows = (reservations.data ?? []) as BuildingNoticeView['reservation'][]
  if (!rows.length) return { ok: true, status: 200, data: { date, arrivals: [] } }
  const ids = rows.map(r => r.id), propertyIds = [...new Set(rows.map(r => r.property_id))]
  const [properties, recipients, notices, history, recipientHistory, tasks, observations] = await Promise.all([
    db.from('properties').select('id,name,active').in('id', propertyIds),
    db.from('building_recipients').select('*').in('property_id', propertyIds).order('address'),
    db.from('building_notices').select('*').in('reservation_id', ids).order('content_version', { ascending: false }),
    db.from('building_notice_history').select('id,notice_id,reservation_id,recipient_id,action,author,source,at,occurred_at,evidence').in('reservation_id', ids).order('at', { ascending: false }).limit(1000),
    db.from('building_notice_history').select('id,notice_id,reservation_id,recipient_id,action,author,source,at,occurred_at,evidence').in('property_id', propertyIds).is('reservation_id', null).order('at', { ascending: false }).limit(1000),
    db.from('tasks').select('id,reservation_id,type,building_notified_at').in('reservation_id', ids).eq('type', 'preparation'),
    db.from('building_notice_observations').select('*').in('reservation_id', ids).order('recorded_at', { ascending: false }),
  ])
  if ([properties, recipients, notices, history, recipientHistory, tasks, observations].some(r => r.error)) return unavailable()
  const arrivals = rows.map(r => {
    const property = properties.data?.find(p => p.id === r.property_id)
    const view: BuildingNoticeView = { reservation: r, property: property?.name ?? '',
      recipients: (recipients.data ?? []).filter(p => p.property_id === r.property_id) as BuildingRecipient[],
      observations: (observations.data ?? []).filter(o => o.reservation_id === r.id) as BuildingNoticeObservation[],
      notices: (notices.data ?? []).filter(n => n.reservation_id === r.id) as BuildingNotice[],
      history: [...(history.data ?? []).filter(h => h.reservation_id === r.id), ...(recipientHistory.data ?? []).filter(h =>
        recipients.data?.some(c => c.property_id === r.property_id && c.id === h.recipient_id))] as BuildingNoticeEvent[],
      legacy_marks: (tasks.data ?? []).filter(t => t.reservation_id === r.id && t.building_notified_at)
        .map(t => ({ task_id: t.id, at: t.building_notified_at as string })), blockers: [] }
    view.blockers = noticeBlockers(view)
    if (!property?.active) view.blockers.push('El apartamento no está activo.')
    return view
  })
  return { ok: true, status: 200, data: { date, arrivals } }
}

export async function previewBuildingNoticeTool(db: Db, query: { reservation_id: string; recipient_id: string }, actor: Actor | null) {
  const result = await listBuildingNoticesTool(db, { reservation_id: query.reservation_id }, actor)
  if (!result.ok) return result
  const view = result.data.arrivals[0], recipient = view?.recipients.find(c => c.id === query.recipient_id)
  if (!view || !recipient) return { ok: false as const, status: 404, error: 'La reserva o el destinatario no están disponibles.' }
  const snapshot = noticeSnapshot(view, recipient)
  return { ok: true as const, status: 200, data: { snapshot,
    message: view.blockers.length ? null : noticeMessage(snapshot),
    blockers: [...view.blockers, ...(currentBuildingObservation(view, recipient) ? ['Existe evidencia histórica vigente; no preparar ni reenviar.'] : []), ...(!recipient.verified_at ? ['El destinatario requiere verificación expresa.'] : [])],
    observations: view.observations,
    notices: view.notices.filter(n => n.recipient_id === recipient.id), legacy_marks: view.legacy_marks, history: view.history } }
}

export async function writeBuildingNoticeTool(db: Db, operation: 'verify_recipient' | 'prepare' | 'record', body: unknown,
  actor: Actor | null): Promise<ServiceResult<BuildingNotice | BuildingRecipient>> {
  if (!await isAdmin(db, actor)) return denied()
  const schema = operation === 'verify_recipient' ? verifyBuildingRecipientSchema
    : operation === 'prepare' ? prepareBuildingNoticeSchema : recordBuildingNoticeSchema
  const parsed = schema.safeParse(body)
  if (!parsed.success) return { ok: false, status: 400, error: 'Revisa los identificadores, versión, fecha con zona horaria, confirmación y evidencia (10–500 caracteres).' }
  if (operation === 'prepare') {
    const input = prepareBuildingNoticeSchema.parse(body)
    const read = await listBuildingNoticesTool(db, { reservation_id: input.reservation_id }, actor)
    if (!read.ok) return read
    const view = read.data.arrivals[0], recipient = view?.recipients.find(r => r.id === input.recipient_id)
    if (view && recipient && currentBuildingObservation(view, recipient)) return { ok: false, status: 409,
      error: 'Ya existe evidencia histórica vigente para esta estancia y destinatario. No prepares un reenvío.' }
  }
  try {
    const { data, error } = await db.rpc('manage_building_notice', { p_operation: operation, p_input: parsed.data,
      p_source: actor!.via, p_actor_id: actor!.id })
    if (error) return { ok: false, status: error.code === '42501' ? 403 : 503,
      error: error.code === '42501' ? 'Se requiere un administrador activo.' : 'El resultado es incierto. Consulta el aviso y conserva la misma clave de reintento antes de repetir.' }
    if (!data?.ok) return { ok: false, status: data?.conflict ? 409 : 400,
      error: data?.error ?? 'No se guardó el registro.', current: data?.current }
    return { ok: true, status: 200, data: data.data }
  } catch {
    return { ok: false, status: 503, error: 'El resultado es incierto. Consulta el aviso antes de reintentar con la misma clave.' }
  }
}

/** Registro retrospectivo separado de preparar/enviar; siempre releído por ID. */
export async function recordHistoricalBuildingNoticeTool(db: Db, body: unknown, actor: Actor | null): Promise<ServiceResult<BuildingNoticeObservation>> {
  if (!await isAdmin(db, actor)) return denied()
  const parsed = historicalBuildingNoticeSchema.safeParse(body)
  if (!parsed.success || Date.parse(parsed.data.occurred_at) > Date.now()) return { ok: false, status: 400,
    error: 'Indica un hecho pasado con zona horaria, destinatario, referencia y evidencia; confirma lo comprobado.' }
  const current = await listBuildingNoticesTool(db, { reservation_id: parsed.data.reservation_id }, actor)
  if (!current.ok) return current
  const view = current.data.arrivals[0], recipient = view?.recipients.find(r => r.id === parsed.data.recipient_id)
  if (!view || !recipient?.verified_at || view.blockers.length || !sameSnapshot(parsed.data.snapshot, noticeSnapshot(view, recipient))) {
    return { ok: false, status: 409, error: 'Verifica el destinatario y relee los datos actuales de la estancia antes de registrar el hecho.' }
  }
  try {
    const { data, error } = await db.rpc('record_historical_building_notice', {
      p_input: parsed.data, p_source: actor!.via, p_actor_id: actor!.id })
    if (error) return { ok: false, status: error.code === '42501' ? 403 : 503,
      error: 'No se confirmó el registro histórico. Consulta antes de reintentar con la misma clave.' }
    if (!data?.ok) return { ok: false, status: data?.conflict ? 409 : 400, error: data?.error ?? 'No se guardó.', current: data?.current }
    const saved = await db.from('building_notice_observations').select('*').eq('id', data.data?.id).maybeSingle()
    if (saved.error || !saved.data || saved.data.reservation_id !== parsed.data.reservation_id
      || !saved.data.snapshot || !sameSnapshot(saved.data.snapshot, parsed.data.snapshot)
      || saved.data.version !== data.data?.version || !saved.data.actor_id || !saved.data.recorded_at
      || saved.data.recipient_id !== parsed.data.recipient_id || saved.data.status !== parsed.data.status
      || saved.data.evidence !== parsed.data.evidence || saved.data.reference !== parsed.data.reference
      || Date.parse(saved.data.occurred_at) !== Date.parse(parsed.data.occurred_at)) {
      return { ok: false, status: 503, error: 'Se intentó guardar, pero no se pudo verificar por lectura. Actualiza antes de repetir.' }
    }
    return { ok: true, status: 200, data: saved.data as BuildingNoticeObservation }
  } catch { return { ok: false, status: 503, error: 'Resultado incierto. Consulta antes de reintentar con la misma clave.' } }
}
