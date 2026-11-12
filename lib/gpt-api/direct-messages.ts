import { z } from 'zod'
import type { Db } from './db'
import type { Actor } from './followups'
import type { ServiceResult } from './service'
import { isIsoDate, todayInBogota } from './dates'
import { DIRECT_STAGES, type DirectPlanView } from '@/lib/direct-messages'
const snapshot = z.object({ property_id: z.string().uuid(), guest_name: z.string(), guests: z.number().int().nullable(), check_in: z.string(), check_out: z.string() }).strict()
export const directDraftSchema = z.object({ reservation_id: z.string().uuid(), stage: z.enum(DIRECT_STAGES), snapshot,
  expected_version: z.number().int().nonnegative(), request_key: z.string().trim().min(1).max(200),
  channel: z.enum(['pending','whatsapp','email']), recipient: z.string().trim().max(200), body: z.string().trim().max(4000),
  scheduled_for: z.string().datetime({ offset: true }).nullable(), reviewed: z.literal(true) }).strict()
async function admin(db: Db, actor: Actor | null) {
  if (!actor) return false
  const { data, error } = await db.from('team_members').select('id,role,active').eq('id', actor.id).maybeSingle()
  return !error && data?.active === true && data.role === 'admin'
}
export async function listDirectMessagePlans(db: Db, actor: Actor | null, from = todayInBogota()): Promise<ServiceResult<DirectPlanView[]>> {
  if (!await admin(db, actor)) return { ok: false, status: 403, error: 'Se requiere un administrador activo.' }
  if (!isIsoDate(from)) return { ok: false, status: 400, error: 'Fecha inválida.' }
  const r = await db.from('reservations').select('id,property_id,source,status,guest_name,guests,check_in,check_out,created_at').eq('source','direct').gte('check_out',from).order('check_in').limit(201)
  if (r.error || (r.data?.length ?? 0) > 200) return { ok: false, status: 503, error: 'No se pudo consultar el plan completo. No se autoriza ningún envío.' }
  if (!r.data?.length) return { ok: true, status: 200, data: [] }
  const [drafts, properties] = await Promise.all([
    db.from('direct_message_drafts').select('*').in('reservation_id',r.data.map(v => v.id)),
    db.from('properties').select('id,name').in('id',r.data.map(v => v.property_id)),
  ])
  if (drafts.error || properties.error) return { ok: false, status: 503, error: 'No se pudo comprobar la planificación guardada. Puede faltar la migración; no se enviará nada.' }
  return { ok: true, status: 200, data: r.data.map(v => ({ reservation: v, apartment: properties.data?.find(p => p.id === v.property_id)?.name ?? '', drafts: drafts.data?.filter(d => d.reservation_id === v.id) ?? [] })) as DirectPlanView[] }
}
export async function saveDirectMessageDraft(db: Db, actor: Actor | null, input: unknown): Promise<ServiceResult> {
  if (!await admin(db, actor)) return { ok: false, status: 403, error: 'Se requiere un administrador activo.' }
  const parsed = directDraftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, status: 400, error: 'Revisa el borrador, la estancia, la hora con zona y la confirmación de revisión.' }
  const { data, error } = await db.rpc('save_direct_message_draft', { p_input: parsed.data, p_source: actor!.via, p_actor_id: actor!.id })
  if (error || !data || typeof data.ok !== 'boolean') return { ok: false, status: 503, error: 'Resultado no confirmado. Recarga antes de reintentar con la misma clave.' }
  if (!data.ok) return { ok: false, status: data.conflict ? 409 : 400, error: data.error, current: data.current }
  const saved = data.data
  if (!saved?.id || !Number.isInteger(saved.version)) return { ok: false, status: 503, error: 'Resultado no confirmado. Conserva la misma clave al reintentar.' }
  const verified = await db.from('direct_message_drafts').select('*').eq('id', saved.id).maybeSingle()
  if (verified.error || !verified.data || verified.data.version !== saved.version || verified.data.reservation_id !== parsed.data.reservation_id || verified.data.stage !== parsed.data.stage) {
    return { ok: false, status: 503, error: 'El guardado no pudo verificarse o cambió después. Recarga antes de reintentar; no se envió ningún mensaje.' }
  }
  return { ok: true, status: 200, data: { ...data, data: verified.data, sending_enabled: false } }
}
