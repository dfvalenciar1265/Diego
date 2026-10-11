import { describe, it, expect } from 'vitest'
import {
  staysOverlap, appendReservationNote, creationNotes, conflictMessage, toReservationOut, type ReservationRow,
} from '@/lib/gpt-api/reservation-writes'

const row = (over: Partial<ReservationRow> = {}): ReservationRow => ({
  id: 'r1', property_id: 'p1', source: 'direct', airbnb_code: null, guest_name: 'Laura Gómez',
  check_in: '2026-10-20', check_out: '2026-10-23', guests: 2, amount: 850000,
  notes: 'Check-in: 3pm | Check-out: 12pm', status: 'confirmed', ...over,
})

describe('staysOverlap', () => {
  it('detects stays that share a night', () => {
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-22', check_out: '2026-10-25' })).toBe(true)
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-18', check_out: '2026-10-26' })).toBe(true)
  })

  it('lets one guest leave the day the next one arrives', () => {
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-23', check_out: '2026-10-25' })).toBe(false)
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-17', check_out: '2026-10-20' })).toBe(false)
  })
})

describe('appendReservationNote', () => {
  it('adds at the end without touching the check-in/check-out times', () => {
    expect(appendReservationNote('Check-in: 3pm | Check-out: 12pm', 'Llega con mascota')).toBe('Check-in: 3pm | Check-out: 12pm | Llega con mascota')
    expect(appendReservationNote('', 'Pagó')).toBe('Pagó')
    expect(appendReservationNote(null, 'Pagó')).toBe('Pagó')
  })

  it('neutralizes "|" and ignores empty notes', () => {
    expect(appendReservationNote('A', 'x | y')).toBe('A | x / y')
    expect(appendReservationNote('A', '   ')).toBe('A')
  })
})

describe('creationNotes', () => {
  it('says who created it from ChatGPT and when', () => {
    expect(creationNotes('Diego', '2026-10-11', '')).toBe('Creada desde ChatGPT por Diego (11-oct)')
    expect(creationNotes('Diego', '2026-10-11', 'Pagó 50%')).toBe('Creada desde ChatGPT por Diego (11-oct) | Pagó 50%')
  })
})

describe('conflictMessage', () => {
  it('names who is already there', () => {
    expect(conflictMessage('Palmetto 1001', [row(), row({ guest_name: 'Pedro', check_in: '2026-10-23', check_out: '2026-10-25' })]))
      .toBe('Palmetto 1001 ya está ocupado en esas fechas: Laura Gómez (20-oct a 23-oct), Pedro (23-oct a 25-oct). No creo ni muevo reservas que se crucen.')
  })
})

describe('toReservationOut', () => {
  it('returns the reservation with the apartment name and a numeric amount', () => {
    expect(toReservationOut(row({ amount: '850000.00' as unknown as number }), 'Palmetto 1001')).toEqual({
      id: 'r1', airbnb_code: null, source: 'direct', guest_name: 'Laura Gómez', property: 'Palmetto 1001',
      check_in: '2026-10-20', check_out: '2026-10-23', guests: 2, amount: 850000, status: 'confirmed',
      notes: 'Check-in: 3pm | Check-out: 12pm',
    })
  })
})
