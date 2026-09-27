import { describe, it, expect } from 'vitest'
import { missingTurnoverTasks, prepDateFor } from '@/lib/turnover-tasks'

const base = { id: 'r1', property_id: 'p1208', guest_name: 'Cesar Augusto Martin Amaya' }

describe('missingTurnoverTasks', () => {
  it('repairs a reservation left with no tasks (the 1208 check-in of 27 sep 2026)', () => {
    const rows = missingTurnoverTasks(
      [{ ...base, check_in: '2026-09-27', check_out: '2026-09-30', tasks: [] }],
      '2026-09-27',
    )
    expect(rows).toEqual([
      expect.objectContaining({ type: 'cleaning', scheduled_for: '2026-09-30', reservation_id: 'r1', property_id: 'p1208' }),
      // prep was due 26 sep — already past, so it lands today instead of the past
      expect.objectContaining({ type: 'preparation', scheduled_for: '2026-09-27', reservation_id: 'r1' }),
    ])
  })

  it('leaves complete reservations alone', () => {
    const rows = missingTurnoverTasks(
      [{ ...base, check_in: '2026-10-02', check_out: '2026-10-04', tasks: [{ type: 'cleaning' }, { type: 'preparation' }] }],
      '2026-09-27',
    )
    expect(rows).toEqual([])
  })

  it('schedules a future prep the day before check-in', () => {
    const rows = missingTurnoverTasks(
      [{ ...base, check_in: '2026-10-10', check_out: '2026-10-12', tasks: [{ type: 'cleaning' }] }],
      '2026-09-27',
    )
    expect(rows).toEqual([expect.objectContaining({ type: 'preparation', scheduled_for: '2026-10-09' })])
  })

  it('only adds the cleaning when the guest is already in', () => {
    const rows = missingTurnoverTasks(
      [{ ...base, check_in: '2026-09-25', check_out: '2026-09-29', tasks: [] }],
      '2026-09-27',
    )
    expect(rows.map(r => r.type)).toEqual(['cleaning'])
  })

  it('ignores stays that already ended', () => {
    const rows = missingTurnoverTasks(
      [{ ...base, check_in: '2026-09-20', check_out: '2026-09-26', tasks: [] }],
      '2026-09-27',
    )
    expect(rows).toEqual([])
  })
})

describe('prepDateFor', () => {
  it('is the day before check-in', () => {
    expect(prepDateFor('2026-10-01', '2026-10-05')).toBe('2026-09-30')
  })
})
