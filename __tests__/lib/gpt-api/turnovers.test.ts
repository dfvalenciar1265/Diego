import { describe, it, expect } from 'vitest'
import {
  parseClockTime, withCheckoutTime, withCheckinTime, checkoutSlot, checkinSlot, type TurnoverReservation,
} from '@/lib/gpt-api/turnovers'

describe('parseClockTime', () => {
  it('reads the ways people say a time', () => {
    expect(parseClockTime('10am')).toBe('10:00')
    expect(parseClockTime('3:30 pm')).toBe('15:30')
    expect(parseClockTime('12 p.m.')).toBe('12:00')
    expect(parseClockTime('12:00 a. m.')).toBe('00:00')
    expect(parseClockTime('15:30')).toBe('15:30')
    expect(parseClockTime('7:05')).toBe('07:05')
  })

  it('rejects anything that is not a clock time', () => {
    expect(parseClockTime('25:00')).toBeNull()
    expect(parseClockTime('13pm')).toBeNull()
    expect(parseClockTime('10:75')).toBeNull()
    expect(parseClockTime('mañana')).toBeNull()
    expect(parseClockTime('')).toBeNull()
  })
})

describe('withCheckoutTime', () => {
  it('leaves only the time, like the pencil on "Salidas de hoy"', () => {
    expect(withCheckoutTime('10:00')).toBe('10:00|')
  })
})

describe('withCheckinTime', () => {
  it('keeps the preparation note, like the pencil on "Preparación hoy"', () => {
    expect(withCheckinTime('15:00|Dejar toallas extra', '18:00')).toBe('18:00|Dejar toallas extra')
    expect(withCheckinTime('Llevar cuna', '18:00')).toBe('18:00|Llevar cuna')
  })

  it('drops the automatic note and handles empty notes', () => {
    expect(withCheckinTime('Preparación para Laura (check-in 2026-10-10)', '18:00')).toBe('18:00|')
    expect(withCheckinTime(null, '18:00')).toBe('18:00|')
    expect(withCheckinTime('15:00|', '18:00')).toBe('18:00|')
  })
})

const reservation = (over: Partial<TurnoverReservation> = {}): TurnoverReservation => ({
  id: 'r1', airbnb_code: 'HMAAA111', guest_name: 'Laura Gómez', guests: 2, property_id: 'p1001',
  check_in: '2026-10-10', check_out: '2026-10-13',
  notes: 'Check-in: 3:00 PM | Check-out: 11:00 AM | Cancelación: Moderada',
  tasks: [], ...over,
})

describe('checkoutSlot', () => {
  it('uses the time set in the app on that day\'s cleaning task', () => {
    const r = reservation({ tasks: [{ id: 't1', type: 'cleaning', scheduled_for: '2026-10-13', notes: '09:30|', status: 'pending' }] })
    expect(checkoutSlot(r, '2026-10-13', 'Palmetto 1001')).toEqual({
      property: 'Palmetto 1001', guest_name: 'Laura Gómez', airbnb_code: 'HMAAA111',
      time: '09:30', time_source: 'app', cleaning_task_id: 't1',
    })
  })

  it('falls back to the reservation email time, then to noon', () => {
    const task = { id: 't1', type: 'cleaning', scheduled_for: '2026-10-13', notes: 'Limpieza post-estadía — Laura', status: 'pending' }
    expect(checkoutSlot(reservation({ tasks: [task] }), '2026-10-13', 'P')).toMatchObject({ time: '11:00', time_source: 'reservation' })
    expect(checkoutSlot(reservation({ notes: '', tasks: [] }), '2026-10-13', 'P')).toMatchObject({
      time: '12:00', time_source: 'default', cleaning_task_id: null,
    })
  })
})

describe('checkinSlot', () => {
  it('uses the time and note set in the app on the preparation task', () => {
    const r = reservation({ tasks: [{ id: 't2', type: 'preparation', scheduled_for: '2026-10-09', notes: '18:00|Llega tarde', status: 'done' }] })
    expect(checkinSlot(r, 'Palmetto 1001')).toEqual({
      property: 'Palmetto 1001', guest_name: 'Laura Gómez', airbnb_code: 'HMAAA111', guests: 2,
      time: '18:00', time_source: 'app', note: 'Llega tarde', preparation_task_id: 't2', preparation_status: 'done',
    })
  })

  it('falls back to the reservation email time, then to 3pm', () => {
    const task = { id: 't2', type: 'preparation', scheduled_for: '2026-10-09', notes: 'Preparación para Laura (check-in 2026-10-10)', status: 'pending' }
    expect(checkinSlot(reservation({ tasks: [task] }), 'P')).toMatchObject({ time: '15:00', time_source: 'reservation', note: '' })
    expect(checkinSlot(reservation({ notes: 'Check-in: 4pm', tasks: [] }), 'P')).toMatchObject({ time: '16:00', time_source: 'reservation' })
    expect(checkinSlot(reservation({ notes: '', tasks: [] }), 'P')).toMatchObject({
      time: '15:00', time_source: 'default', preparation_task_id: null, preparation_status: null,
    })
  })
})
