import type { TodayCheckOut } from '@/actions/dashboard'
import { resolveReservationTiming } from '@/lib/reservation-times'
import { timingReservation as stay } from './timing'

export const cleanerId = '00000000-0000-0000-0000-000000008001'
export const otherCleanerId = '00000000-0000-0000-0000-000000008002'
export const adminId = '00000000-0000-0000-0000-000000008003'
export function checkout(): TodayCheckOut {
  return {
    id: stay.id, property_id: stay.property_id, stay, timing: resolveReservationTiming(stay, 'checkout'),
    guest_name: 'Huésped Sintético', property_name: 'Apartamento Sintético 1214', guests: 2,
    check_out_time: '11am', check_out_time_24: '11:00', cleaning_task_id: '00000000-0000-0000-0000-000000008004',
    cleaning: { review: null, task: { id: '00000000-0000-0000-0000-000000008004', property_id: stay.property_id,
      reservation_id: stay.id, scheduled_for: stay.check_out, status: 'pending', assigned_to: null, assignee_name: null, completed_at: null } },
  }
}
