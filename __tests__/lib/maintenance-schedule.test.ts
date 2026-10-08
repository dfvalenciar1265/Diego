import { describe, it, expect } from 'vitest'
import { advanceNextDue } from '@/lib/maintenance-schedule'

describe('advanceNextDue', () => {
  it('moves a recurring preventive forward by its interval', () => {
    expect(advanceNextDue('2026-09-16', 1)).toBe('2026-10-16')   // fumigación mensual
    expect(advanceNextDue('2026-09-16', 3)).toBe('2026-12-16')   // aires cada 3 meses
    expect(advanceNextDue('2026-11-20', 3)).toBe('2027-02-20')
  })

  it('lands on the last day when the target month is shorter', () => {
    expect(advanceNextDue('2026-01-31', 1)).toBe('2026-02-28')
    expect(advanceNextDue('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('leaves the next date empty without an interval', () => {
    expect(advanceNextDue('2026-10-08', null)).toBeNull()
    expect(advanceNextDue('2026-10-08', 0)).toBeNull()
  })
})
