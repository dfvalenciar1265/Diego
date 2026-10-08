import { describe, it, expect } from 'vitest'
import { todayInBogota, shortDate, isIsoDate, addDays, daysBetween } from '@/lib/gpt-api/dates'

describe('todayInBogota', () => {
  it('uses the Colombian day, not the UTC one', () => {
    // 02:00 UTC on the 9th is still 9 p.m. on the 8th in Cartagena
    expect(todayInBogota(new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-08')
    expect(todayInBogota(new Date('2026-10-08T15:00:00Z'))).toBe('2026-10-08')
  })
})

describe('shortDate', () => {
  it('formats as day-month in Spanish', () => {
    expect(shortDate('2026-10-13')).toBe('13-oct')
    expect(shortDate('2027-01-05')).toBe('5-ene')
  })
})

describe('isIsoDate', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isIsoDate('2026-10-08')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('8/10/2026')).toBe(false)
    expect(isIsoDate(20261008)).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-10-08', -30)).toBe('2026-09-08')
    expect(daysBetween('2026-10-08', '2027-02-05')).toBe(120)
  })
})
