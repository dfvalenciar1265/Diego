import { describe, expect, it } from 'vitest'
import { dashboardDay } from '@/lib/dashboard-day'

describe('día mostrado en Inicio, America/Bogota', () => {
  it.each([
    ['2026-11-01T23:59:59.999Z', '2026-11-01', '2026-11-01', false],
    ['2026-11-02T00:00:00.000Z', '2026-11-01', '2026-11-02', true],
    ['2026-11-02T04:59:59.999Z', '2026-11-01', '2026-11-02', true],
    ['2026-11-02T05:00:00.000Z', '2026-11-02', '2026-11-02', false],
    ['2026-12-01T00:00:00.000Z', '2026-11-30', '2026-12-01', true],
    ['2027-01-01T00:00:00.000Z', '2026-12-31', '2027-01-01', true],
    ['2028-03-01T00:00:00.000Z', '2028-02-29', '2028-03-01', true],
  ])('%s: día real %s, se muestra %s', (instant, today, date, tomorrow) => {
    expect(dashboardDay(new Date(instant))).toMatchObject({ today, date, tomorrow, label: tomorrow ? 'mañana' : 'hoy' })
  })
  it('programa el corte y la actualización del rótulo en medianoche, sin saltar otro día', () => {
    const before = dashboardDay(new Date('2026-11-01T23:59:59Z'))
    expect(before.nextChangeAt).toBe(Date.parse('2026-11-02T00:00:00Z'))
    const after = dashboardDay(new Date(before.nextChangeAt))
    expect(after.nextChangeAt).toBe(Date.parse('2026-11-02T05:00:00Z'))
    const midnight = dashboardDay(new Date(after.nextChangeAt))
    expect(midnight.date).toBe(after.date)
    expect(midnight.key).not.toBe(after.key)
  })
})
