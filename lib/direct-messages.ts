import { addDays, isIsoDate } from './gpt-api/dates'
export const DIRECT_STAGES = ['confirmation', 'registration', 'arrival', 'departure'] as const
export type DirectStage = typeof DIRECT_STAGES[number]
export type DirectChannel = 'pending' | 'whatsapp' | 'email'
export const DIRECT_LABELS: Record<DirectStage, string> = { confirmation: 'Confirmación', registration: 'Registro', arrival: 'Llegada', departure: 'Salida' }
export interface DirectReservation { id: string; property_id: string; source: string; status: string; guest_name: string; guests: number | null; check_in: string; check_out: string; created_at: string }
export interface DirectSnapshot { property_id: string; guest_name: string; guests: number | null; check_in: string; check_out: string }
export interface DirectDraft { id: string; reservation_id: string; stage: DirectStage; snapshot: DirectSnapshot; channel: DirectChannel; recipient: string; body: string; scheduled_for: string | null; status: 'draft' | 'review_required' | 'cancelled'; version: number; review_reason: string | null }
export interface DirectPlanView { reservation: DirectReservation; apartment: string; drafts: DirectDraft[] }
export function directSnapshot(r: DirectReservation): DirectSnapshot { return { property_id: r.property_id, guest_name: r.guest_name, guests: r.guests, check_in: r.check_in, check_out: r.check_out } }
export function directPlanBlockers(r: DirectReservation): string[] {
  const problems: string[] = []
  if (r.source !== 'direct') problems.push('Solo corresponde a reservas directas.')
  if (r.status !== 'confirmed') problems.push('La reserva no está confirmada. Un bloqueo no acredita una reserva directa.')
  if (!isIsoDate(r.check_in) || !isIsoDate(r.check_out) || r.check_out <= r.check_in) problems.push('Revisa las fechas de la estancia.')
  if (!r.guest_name.trim() || !r.guests || r.guests < 1) problems.push('Faltan titular o cantidad de huéspedes.')
  return problems
}
/** Sugerencia de fecha, nunca hora ni autorización de envío. */
export function suggestedDirectDate(r: DirectReservation, stage: DirectStage): string | null {
  if (!isIsoDate(r.check_in) || !isIsoDate(r.check_out)) return null
  if (stage === 'confirmation') return null
  return stage === 'departure' ? addDays(r.check_out, -1) : addDays(r.check_in, -1)
}
export function directDraftNeedsReview(r: DirectReservation, draft: DirectDraft): boolean {
  return directPlanBlockers(r).length > 0 || draft.status !== 'draft' || Object.entries(directSnapshot(r)).some(([key,value]) => draft.snapshot[key as keyof DirectSnapshot] !== value)
}
