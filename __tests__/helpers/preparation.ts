import type { PreparationArrival, PreparationState, PreparationView } from '@/lib/gpt-api/preparation'
import { timingReservation as r } from './timing'
export const preparationArrival = (over: Partial<PreparationArrival> = {}): PreparationArrival => ({
  ...r, status: 'confirmed', airbnb_code: null, guest_name: 'Huésped Sintético', guests: 2, notes: null,
  property: { name: 'Apartamento Sintético 1214' },
  tasks: [{ id: '00000000-0000-0000-0000-000000007002', property_id: r.property_id, type: 'preparation',
    scheduled_for: r.check_in, status: 'pending', notes: '15:00|Dejar dos toallas adicionales', building_notified_at: null }], ...over,
})
export const preparationState = (over: Partial<PreparationState> = {}): PreparationState => ({
  reservation_id: r.id, property_id: r.property_id, stay_check_in: r.check_in, stay_check_out: r.check_out, version: 0,
  cleaned_at: null, cleaned_by: null, cleaned_name: null, checked_at: null, checked_by: null, checked_name: null,
  ready_at: null, ready_by: null, ready_name: null, review_reason: null, updated_at: '2026-10-30T03:30:00Z', ...over,
})
export const preparationView = (over: Partial<PreparationView> = {}): PreparationView => ({
  available: true, can_confirm: true, error: null, state: null, issues: [], requests: [], history: [],
  blockers: ['Falta confirmar la limpieza para esta llegada.', 'Falta la revisión de funcionamiento.'], ...over,
})
