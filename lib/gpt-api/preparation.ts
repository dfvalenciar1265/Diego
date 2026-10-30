/** Preparación explícita de una llegada; nunca se deduce de una limpieza de salida o de notas. */
import type { Db } from './db'
import { addDays, isIsoDate, todayInBogota } from './dates'
import { isUuid } from './validate'

export * from '@/lib/preparation'
import { preparationBlockers, type PreparationArrival, type PreparationReservation, type PreparationView, type PreparationState, type PreparationIssue, type PreparationRequest, type PreparationWrite, PREPARATION_STEPS } from '@/lib/preparation'

/** Consultas acotadas y sin montos. Si falta la migración o falla una lectura, no certifica nada. */
export async function preparationViews(db: Db, reservations: PreparationReservation[], today = todayInBogota()): Promise<Record<string, PreparationView>> {
  if (!reservations.length) return {}
  const ids = [...new Set(reservations.map(r => r.id))]
  const properties = [...new Set(reservations.map(r => r.property_id))]
  const unavailable = (r: PreparationReservation): PreparationView => ({ available: false, can_confirm: false,
    error: 'No se pudo comprobar la preparación. Actualiza antes de confirmar.', state: null,
    issues: [], requests: [], history: [], blockers: preparationBlockers(r, null, [], [], today) })
  try {
    const [states, issues, requests, history] = await Promise.all([
      db.from('arrival_preparations').select('*').in('reservation_id', ids),
      db.from('maintenance').select('id, property_id, title, priority, status').in('property_id', properties).neq('status', 'resolved').neq('priority', 'scheduled'),
      db.from('special_requests').select('id, reservation_id, description, status, review_reason').in('reservation_id', ids).neq('status', 'cancelled'),
      db.from('arrival_preparation_history').select('id, reservation_id, version, action, reason, author, source, at').in('reservation_id', ids).order('version', { ascending: false }).limit(1000),
    ])
    return Object.fromEntries(reservations.map(r => {
      // DTO explícito: no serializar objetos de mantenimiento/solicitudes con costos u otros campos.
      const ownIssues: PreparationIssue[] = (issues.data ?? []).filter(i => i.property_id === r.property_id)
        .map(i => ({ id: i.id, property_id: i.property_id, title: i.title, priority: i.priority, status: i.status }))
        .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent'))
      const ownRequests: PreparationRequest[] = (requests.data ?? []).filter(q => q.reservation_id === r.id)
        .map(q => ({ id: q.id, reservation_id: q.reservation_id, description: q.description, status: q.status, review_reason: q.review_reason }))
      const row = (states.data ?? []).find(s => s.reservation_id === r.id) as PreparationState | undefined
      const stale = row && (row.property_id !== r.property_id || row.stay_check_in !== r.check_in || row.stay_check_out !== r.check_out || r.status !== 'confirmed')
      const state = row ? { ...row, ...(stale ? {
        cleaned_at: null, cleaned_by: null, cleaned_name: null, checked_at: null, checked_by: null, checked_name: null,
        ready_at: null, ready_by: null, ready_name: null, review_reason: 'La preparación corresponde a otra estancia; vuelve a confirmar.',
      } : {}) } : null
      const failed = Boolean(states.error || issues.error || requests.error || history.error)
      return [r.id, { available: !failed, can_confirm: !failed && r.status === 'confirmed' && today >= addDays(r.check_in, -1) && today <= r.check_in,
        error: failed ? unavailable(r).error : null, state,
        issues: ownIssues, requests: ownRequests,
        history: (history.data ?? []).filter(h => h.reservation_id === r.id).slice(0, 15).map(h => ({
          id: h.id, version: h.version, action: h.action, reason: h.reason, author: h.author, source: h.source, at: h.at,
        })), blockers: preparationBlockers(r, state, ownIssues, ownRequests, today) }]
    }))
  } catch { return Object.fromEntries(reservations.map(r => [r.id, unavailable(r)])) }
}

/** Una tarjeta por reserva: las tareas duplicadas se conservan como evidencia, sin elegir una copia. */
export async function preparationArrivals(db: Db, today = todayInBogota()): Promise<PreparationArrival[]> {
  const { data, error } = await db.from('reservations')
    .select('id, property_id, airbnb_code, guest_name, guests, check_in, check_out, notes, status, time_version, time_events:reservation_time_events(*), property:properties(name), tasks(id, property_id, type, scheduled_for, notes, status, building_notified_at)')
    .eq('status', 'confirmed').gte('check_in', today).lte('check_in', addDays(today, 1)).order('check_in').order('guest_name')
  if (error) throw new Error('No se pudieron consultar las llegadas para preparar.')
  return (data ?? []) as unknown as PreparationArrival[]
}

export async function writePreparation(db: Db, input: PreparationWrite, actor: { id: string; via: 'app' | 'mcp' }) {
  if (!input || !isUuid(input.reservation_id) || !PREPARATION_STEPS.includes(input.step) || typeof input.confirmed !== 'boolean'
    || !Number.isInteger(input.expected_version) || input.expected_version < 0 || !isIsoDate(input.stay_check_in)
    || !isIsoDate(input.stay_check_out) || input.stay_check_out <= input.stay_check_in || typeof input.request_key !== 'string'
    || !input.request_key.trim() || input.request_key.length > 200 || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 500))
    || (!input.confirmed && !input.reason?.trim())) {
    return { ok: false as const, status: 400, error: 'Datos de preparación inválidos; reabrir exige un motivo.' }
  }
  const { data, error } = await db.rpc('record_arrival_preparation', {
    p_reservation_id: input.reservation_id, p_step: input.step, p_confirmed: input.confirmed,
    p_expected_version: input.expected_version, p_request_key: input.request_key,
    p_stay_check_in: input.stay_check_in, p_stay_check_out: input.stay_check_out,
    p_reason: input.reason?.trim() ?? '', p_source: actor.via, p_actor_id: actor.id,
  })
  if (error) return { ok: false as const, status: error.code === '42501' ? 403 : ['40001', '40P01'].includes(error.code) ? 409 : 400,
    error: error.code === '42501' ? 'Tu sesión no tiene permiso para esta etapa.' : 'No se confirmó la preparación. Actualiza y revisa antes de reintentar.' }
  if (!data || typeof data.ok !== 'boolean') return { ok: false as const, status: 500, error: 'Resultado incierto. Consulta la preparación antes de reintentar.' }
  if (!data.ok) return { ok: false as const, status: data.conflict ? 409 : 400, error: String(data.error), current: data.current as PreparationState | null }
  return { ok: true as const, status: 200, data: { state: data.data as PreparationState, replayed: Boolean(data.replayed) } }
}
