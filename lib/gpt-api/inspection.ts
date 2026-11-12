import type { Db } from './db'
import { isUuid } from './validate'
import { isIsoDate } from './dates'
import { INSPECTION_ITEMS, type InspectionState, type InspectionWrite } from '@/lib/inspection'
export async function readInspection(db: Db, reservationId: string): Promise<{ state: InspectionState | null; error: string | null }> {
  if (!isUuid(reservationId)) return { state: null, error: 'Reserva no válida.' }
  const { data, error } = await db.from('arrival_inspections').select('reservation_id,property_id,stay_check_in,stay_check_out,version,invalidated_at,checks').eq('reservation_id', reservationId).maybeSingle()
  return error ? { state: null, error: 'No se pudo comprobar el checklist. No confirma ninguna revisión.' } : { state: data as InspectionState | null, error: null }
}
export function validateInspection(input: InspectionWrite) {
  if (!input || !isUuid(input.reservation_id) || !isUuid(input.property_id) || !isIsoDate(input.stay_check_in) || !isIsoDate(input.stay_check_out)
    || input.stay_check_out <= input.stay_check_in || !INSPECTION_ITEMS.some(i => i.key === input.item)
    || !['checked','issue','not_applicable'].includes(input.result) || typeof input.note !== 'string' || input.note.length > 1000
    || (input.result !== 'checked' && input.note.trim().length < 10)
    || !Number.isInteger(input.expected_version) || input.expected_version < 0 || typeof input.request_key !== 'string' || !input.request_key.trim() || input.request_key.length > 200
    || (input.photo_path != null && (typeof input.photo_path !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(input.photo_path)))) return false
  return true
}
export async function writeInspection(db: Db, input: InspectionWrite) {
  if (!validateInspection(input)) return { ok: false as const, error: 'Datos de revisión inválidos. Describe el problema o por qué no aplica (mínimo 10 caracteres).' }
  const { data, error } = await db.rpc('record_arrival_inspection', { p_reservation_id: input.reservation_id, p_property_id: input.property_id,
    p_stay_check_in: input.stay_check_in, p_stay_check_out: input.stay_check_out, p_item: input.item, p_result: input.result,
    p_note: input.note.trim(), p_photo_path: input.photo_path ?? null, p_expected_version: input.expected_version, p_request_key: input.request_key })
  if (error || !data || typeof data.ok !== 'boolean') return { ok: false as const, error: 'No se confirmó el registro. Actualiza antes de reintentar.' }
  return data as { ok: boolean; error?: string; conflict?: boolean; replayed?: boolean; data?: InspectionState }
}
