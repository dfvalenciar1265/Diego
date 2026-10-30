/** Tipos y reglas de presentación; sin clientes ni consultas de base en el navegador. */
import { addDays } from './gpt-api/dates'
import type { UserRole } from './types'
import type { TurnoverReservation, TurnoverTask } from './gpt-api/turnovers'

export const PREPARATION_STEPS = ['cleaning', 'functioning', 'ready'] as const
export type PreparationStep = typeof PREPARATION_STEPS[number]
export interface PreparationState {
  reservation_id: string; property_id: string; stay_check_in: string; stay_check_out: string; version: number
  cleaned_at: string | null; cleaned_by: string | null; cleaned_name: string | null
  checked_at: string | null; checked_by: string | null; checked_name: string | null
  ready_at: string | null; ready_by: string | null; ready_name: string | null
  review_reason: string | null; updated_at: string
}
export interface PreparationIssue { id: string; property_id: string; title: string; priority: string; status: string }
export interface PreparationRequest { id: string; reservation_id: string; description: string; status: string; review_reason: string | null }
export interface PreparationHistory { id: string; version: number; action: string; reason: string | null; author: string; source: string; at: string }
export interface PreparationView {
  available: boolean; can_confirm: boolean; error: string | null; state: PreparationState | null
  issues: PreparationIssue[]; requests: PreparationRequest[]; history: PreparationHistory[]; blockers: string[]
}
export type PreparationReservation = Pick<TurnoverReservation, 'id' | 'property_id' | 'check_in' | 'check_out' | 'status'>
export interface PreparationArrival extends TurnoverReservation {
  property: { name: string } | null
  tasks: (TurnoverTask & { property_id: string; building_notified_at?: string | null })[]
}
export interface PreparationWrite {
  reservation_id: string; step: PreparationStep; confirmed: boolean; expected_version: number
  request_key: string; stay_check_in: string; stay_check_out: string; reason?: string
}
export function canConfirmPreparation(role: UserRole, step: PreparationStep) {
  if (!PREPARATION_STEPS.includes(step)) return false
  return step === 'ready' ? ['admin', 'anfitrion'].includes(role)
    : step === 'cleaning' ? ['admin', 'anfitrion', 'cleaning'].includes(role)
      : ['admin', 'anfitrion', 'cleaning', 'maintenance'].includes(role)
}
export function preparationConfirmation(state: PreparationState | null, step: PreparationStep) {
  const prefix = step === 'cleaning' ? 'cleaned' : step === 'functioning' ? 'checked' : 'ready'
  return { at: state?.[`${prefix}_at`] ?? null, name: state?.[`${prefix}_name`] ?? null }
}
export function preparationBlockers(r: PreparationReservation, state: PreparationState | null,
  issues: PreparationIssue[], requests: PreparationRequest[], today: string) {
  const blockers: string[] = []
  if (r.status !== 'confirmed') blockers.push('La reserva no está confirmada.')
  if (today < addDays(r.check_in, -1) || today > r.check_in) blockers.push('Se confirma el día anterior o el día de llegada, en Colombia.')
  if (!state?.cleaned_at) blockers.push('Falta confirmar la limpieza para esta llegada.')
  if (!state?.checked_at) blockers.push('Falta la revisión de funcionamiento.')
  if (issues.some(i => i.priority === 'urgent')) blockers.push('Hay incidencias urgentes abiertas.')
  if (requests.some(q => q.status !== 'ready' || q.review_reason)) blockers.push('Hay solicitudes especiales pendientes o por revisar.')
  return blockers
}
