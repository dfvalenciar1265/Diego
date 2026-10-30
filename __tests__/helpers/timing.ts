import type { TimeEvent, TimingReservation } from '@/lib/reservation-times'
export const timingReservation: TimingReservation = {
  id: '00000000-0000-0000-0000-000000007001', property_id: '00000000-0000-0000-0000-0000000013a3',
  check_in: '2027-02-10', check_out: '2027-02-13', status: 'confirmed', time_events: [],
}
export const timeEvent = (over: Partial<TimeEvent> = {}): TimeEvent => ({
  id: 'event-1', reservation_id: timingReservation.id, direction: 'checkin', kind: 'estimate', time: '09:00',
  stay_check_in: timingReservation.check_in, stay_check_out: timingReservation.check_out,
  property_id: timingReservation.property_id, source: 'app', request_key: 'synthetic-request',
  actor_id: '00000000-0000-0000-0000-0000000000d1', author: 'Admin Sintético',
  observed_at: '2026-10-30T03:30:00Z', recorded_at: '2026-10-30T03:30:00Z', version: 1,
  task_id: null, invalidated_at: null, ...over,
})
