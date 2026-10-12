import { describe, it, expect, vi, beforeEach } from 'vitest'

const insert = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ insert }),
  }),
}))
vi.mock('@/lib/gpt-api/dates', async orig => ({
  ...(await orig<typeof import('@/lib/gpt-api/dates')>()),
  todayInBogota: () => '2026-10-12',
}))

import { createMaintenanceIssue } from '@/actions/maintenance'

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const base = { property_id: 'p1', title: 'Fumigación', description: '' }

describe('createMaintenanceIssue', () => {
  beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }) })

  it('una incidencia normal no lleva fechas de preventivo', async () => {
    const res = await createMaintenanceIssue(fd({ ...base, priority: 'normal', next_due: '2026-12-01', interval_months: '3' }))
    expect(res.success).toBe(true)
    const row = insert.mock.calls[0][0]
    expect(row.priority).toBe('normal')
    expect(row).not.toHaveProperty('next_due')
    expect(row).not.toHaveProperty('interval_months')
  })

  it('un programado guarda próxima fecha e intervalo', async () => {
    await createMaintenanceIssue(fd({ ...base, priority: 'scheduled', next_due: '2026-11-15', interval_months: '6' }))
    expect(insert.mock.calls[0][0]).toMatchObject({ priority: 'scheduled', next_due: '2026-11-15', interval_months: 6 })
  })

  it('programado sin fecha usa hoy en Colombia; «Sin repetir» guarda intervalo nulo', async () => {
    await createMaintenanceIssue(fd({ ...base, priority: 'scheduled', next_due: '', interval_months: '' }))
    expect(insert.mock.calls[0][0]).toMatchObject({ next_due: '2026-10-12', interval_months: null })
  })

  it.each([
    [{ next_due: '2026-02-30', interval_months: '3' }, /fecha/],
    [{ next_due: '2026-11-15', interval_months: '5' }, /meses/],
    [{ next_due: '2026-11-15', interval_months: 'abc' }, /meses/],
  ])('rechaza datos de preventivo inválidos %o', async (extra, msg) => {
    const res = await createMaintenanceIssue(fd({ ...base, priority: 'scheduled', ...extra }))
    expect(res.success).toBe(false)
    expect(res.error).toMatch(msg)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rechaza prioridad desconocida o campos obligatorios vacíos', async () => {
    expect((await createMaintenanceIssue(fd({ ...base, priority: 'hoy' }))).success).toBe(false)
    expect((await createMaintenanceIssue(fd({ ...base, title: '  ' }))).success).toBe(false)
    expect((await createMaintenanceIssue(fd({ ...base, property_id: '' }))).success).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })
})
