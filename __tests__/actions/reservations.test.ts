import { describe, it, expect } from 'vitest'
import { getOccupiedDaysInWeek, reservationOverlapsDate } from '@/lib/utils'

describe('reservation utils', () => {
  it('counts occupied days in a week window', () => {
    expect(getOccupiedDaysInWeek('2026-05-26', '2026-05-30', '2026-05-25', '2026-05-31')).toBe(4)
  })

  it('returns 0 if reservation is outside the week', () => {
    expect(getOccupiedDaysInWeek('2026-06-01', '2026-06-03', '2026-05-25', '2026-05-31')).toBe(0)
  })

  it('detects overlap with a given date', () => {
    expect(reservationOverlapsDate('2026-05-26', '2026-05-30', '2026-05-28')).toBe(true)
    expect(reservationOverlapsDate('2026-05-26', '2026-05-30', '2026-05-30')).toBe(false)
    expect(reservationOverlapsDate('2026-05-26', '2026-05-30', '2026-05-25')).toBe(false)
  })
})
