import type { Db } from './gpt-api/db'
import { isIsoDate } from './gpt-api/dates'
import { validTime, type TimeDirection, type TimeEvent, type TimeKind } from './reservation-times'

export interface TimeWrite {
  reservation_id: string
  direction: TimeDirection
  kind: Exclude<TimeKind, 'platform'>
  time: string | null
  expected_version: number
  request_key: string
  stay_check_in: string
  stay_check_out: string
}
export async function writeReservationTime(db: Db, input: TimeWrite, actor: { id: string; via: 'app' | 'mcp' }) {
  if (!input || !['checkin', 'checkout'].includes(input.direction) || !['estimate', 'authorization'].includes(input.kind)
    || (input.time !== null && !validTime(input.time)) || !Number.isInteger(input.expected_version) || input.expected_version < 0
    || typeof input.request_key !== 'string' || !input.request_key.trim() || input.request_key.length > 200
    || !isIsoDate(input.stay_check_in) || !isIsoDate(input.stay_check_out)) {
    return { ok: false as const, status: 400, error: 'Datos de horario inválidos.' }
  }
  const { data, error } = await db.rpc('record_reservation_time', {
    p_reservation_id: input.reservation_id, p_direction: input.direction, p_kind: input.kind, p_time: input.time,
    p_expected_version: input.expected_version, p_request_key: input.request_key,
    p_source: actor.via, p_actor_id: actor.id, p_stay_check_in: input.stay_check_in, p_stay_check_out: input.stay_check_out,
  })
  if (error) return {
    ok: false as const, status: ['40001', '40P01'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 400,
    error: ['40001', '40P01'].includes(error.code)
      ? 'El horario o la estancia cambió. Actualiza y revisa el estado antes de reintentar.' : error.message,
  }
  if (!data) return { ok: false as const, status: 500, error: 'No se confirmó el registro del horario. Consulta el estado antes de reintentar.' }
  return { ok: true as const, status: 200, data: data as TimeEvent }
}
