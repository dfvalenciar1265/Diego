import { describe, it, expect } from 'vitest'
import { getTaskStatusLabel, getTaskStatusColor, isTaskOverdue } from '@/lib/utils'

describe('task utils', () => {
  it('returns correct label for each status', () => {
    expect(getTaskStatusLabel('pending')).toBe('Pendiente')
    expect(getTaskStatusLabel('in_progress')).toBe('En curso')
    expect(getTaskStatusLabel('done')).toBe('Completado')
  })

  it('returns correct color class for each status', () => {
    expect(getTaskStatusColor('pending')).toBe('#f97316')
    expect(getTaskStatusColor('in_progress')).toBe('#6366f1')
    expect(getTaskStatusColor('done')).toBe('#22c55e')
  })

  it('marks task as overdue if scheduled_for is past and not done', () => {
    expect(isTaskOverdue('2026-01-01', 'pending')).toBe(true)
    expect(isTaskOverdue('2099-12-31', 'pending')).toBe(false)
    expect(isTaskOverdue('2026-01-01', 'done')).toBe(false)
  })
})
