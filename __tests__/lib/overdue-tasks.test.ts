import { describe, it, expect } from 'vitest'
import { planOverdueTasks } from '@/lib/overdue-tasks'

describe('planOverdueTasks', () => {
  it('drops cleanings nobody started instead of marking them done', () => {
    expect(planOverdueTasks([{ id: 'c1', type: 'cleaning', status: 'pending' }]))
      .toEqual({ drop: ['c1'], close: [] })
  })

  it('closes cleanings someone started (they keep their assignee)', () => {
    expect(planOverdueTasks([{ id: 'c2', type: 'cleaning', status: 'in_progress' }]))
      .toEqual({ drop: [], close: ['c2'] })
  })

  it('keeps auto-closing other tasks and never touches preparations or done tasks', () => {
    expect(planOverdueTasks([
      { id: 'o1', type: 'other', status: 'pending' },
      { id: 'p1', type: 'preparation', status: 'pending' },
      { id: 'd1', type: 'cleaning', status: 'done' },
    ])).toEqual({ drop: [], close: ['o1'] })
  })
})
