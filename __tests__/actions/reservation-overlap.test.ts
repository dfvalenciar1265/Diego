import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Minimal in-memory Supabase fake (only what actions/reservations.ts uses) ──────────────────
type Row = Record<string, unknown>
interface State {
  reservations: Row[]
  properties: Row[]
  taskError: string | null
  taskWrites: { op: string; payload: unknown }[]
  reservationWrites: { op: string; payload: unknown }[]
}
let state: State

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: unknown = null

  function run(): { data: unknown; error: { message: string } | null } {
    if (table === 'team_members') return { data: [{ role: 'admin' }], error: null }
    if (table === 'tasks') {
      state.taskWrites.push({ op, payload })
      return state.taskError ? { data: null, error: { message: state.taskError } } : { data: [], error: null }
    }
    const rows = table === 'reservations' ? state.reservations : state.properties
    if (op === 'insert') {
      const row = { id: 'new-id', ...(payload as Row) }
      state.reservationWrites.push({ op, payload })
      rows.push(row)
      return { data: [row], error: null }
    }
    const matched = rows.filter(r => filters.every(f => f(r)))
    if (op === 'update') {
      state.reservationWrites.push({ op, payload })
      matched.forEach(r => Object.assign(r, payload as Row))
    }
    return { data: matched, error: null }
  }

  const b = {
    select: () => b,
    order: () => b,
    insert: (p: unknown) => { op = 'insert'; payload = p; return b },
    update: (p: unknown) => { op = 'update'; payload = p; return b },
    delete: () => { op = 'delete'; return b },
    eq:  (k: string, v: unknown) => { filters.push(r => r[k] === v); return b },
    neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return b },
    lt:  (k: string, v: string) => { filters.push(r => String(r[k]) < v); return b },
    gt:  (k: string, v: string) => { filters.push(r => String(r[k]) > v); return b },
    is:  () => b,
    ilike: () => b,
    single: async () => {
      const { data, error } = run()
      return { data: (data as Row[] | null)?.[0] ?? null, error }
    },
    maybeSingle: async () => {
      const { data, error } = run()
      return { data: (data as Row[] | null)?.[0] ?? null, error }
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  }
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => builder(table),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { createReservation, updateReservation } from '@/actions/reservations'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const base = { property_id: 'p1', source: 'direct', guest_name: 'Luis', amount: '0', notes: '' }

beforeEach(() => {
  state = {
    properties: [{ id: 'p1', name: 'Cartagena Beach Crespo 1214' }],
    reservations: [
      { id: 'r1', property_id: 'p1', guest_name: 'Ana Pérez', check_in: '2026-10-13', check_out: '2026-10-16', status: 'confirmed' },
      { id: 'r2', property_id: 'p1', guest_name: 'Viejo', check_in: '2026-10-20', check_out: '2026-10-25', status: 'cancelled' },
    ],
    taskError: null,
    taskWrites: [],
    reservationWrites: [],
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createReservation — cruces y fechas', () => {
  it('rechaza una reserva que se cruza, nombrando al huésped y las fechas', async () => {
    const res = await createReservation(form({ ...base, check_in: '2026-10-15', check_out: '2026-10-18' }))
    expect(res.success).toBe(false)
    expect(res.error).toContain('Cartagena Beach Crespo 1214')
    expect(res.error).toContain('Ana Pérez (13-oct a 16-oct)')
    expect(state.reservationWrites).toHaveLength(0)
  })

  it('permite llegar el mismo día que sale el otro huésped', async () => {
    const res = await createReservation(form({ ...base, check_in: '2026-10-16', check_out: '2026-10-18' }))
    expect(res).toEqual({ success: true, warning: undefined })
  })

  it('ignora reservas canceladas', async () => {
    const res = await createReservation(form({ ...base, check_in: '2026-10-21', check_out: '2026-10-23' }))
    expect(res.success).toBe(true)
  })

  it('rechaza check-out igual o anterior al check-in', async () => {
    const same = await createReservation(form({ ...base, check_in: '2026-11-01', check_out: '2026-11-01' }))
    expect(same.success).toBe(false)
    expect(same.error).toMatch(/check-out/)
    const before = await createReservation(form({ ...base, check_in: '2026-11-05', check_out: '2026-11-01' }))
    expect(before.success).toBe(false)
  })

  it('avisa (sin fallar) si no se pudieron crear las tareas', async () => {
    state.taskError = 'boom'
    const res = await createReservation(form({ ...base, check_in: '2026-11-01', check_out: '2026-11-03' }))
    expect(res.success).toBe(true)
    expect(res.warning).toMatch(/tareas/)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('updateReservation — cruces y fechas', () => {
  beforeEach(() => {
    state.reservations.push({
      id: 'r3', property_id: 'p1', guest_name: 'Carlos', check_in: '2026-10-16', check_out: '2026-10-19', status: 'confirmed',
    })
  })

  it('no se cruza consigo misma al editar sin mover fechas', async () => {
    const res = await updateReservation('r3', form({ ...base, guest_name: 'Carlos', check_in: '2026-10-16', check_out: '2026-10-19' }))
    expect(res.success).toBe(true)
  })

  it('rechaza mover las fechas encima de otra reserva', async () => {
    const res = await updateReservation('r3', form({ ...base, guest_name: 'Carlos', check_in: '2026-10-15', check_out: '2026-10-19' }))
    expect(res.success).toBe(false)
    expect(res.error).toContain('Ana Pérez')
    expect(state.reservationWrites).toHaveLength(0)
  })

  it('rechaza check-out antes del check-in', async () => {
    const res = await updateReservation('r3', form({ ...base, check_in: '2026-10-19', check_out: '2026-10-17' }))
    expect(res.success).toBe(false)
  })

  it('avisa si no se pudieron mover las tareas ligadas', async () => {
    state.taskError = 'boom'
    const res = await updateReservation('r3', form({ ...base, guest_name: 'Carlos', check_in: '2026-10-17', check_out: '2026-10-20' }))
    expect(res.success).toBe(true)
    expect(res.warning).toMatch(/tareas/)
  })
})
