import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type Row } from '../helpers/fake-db'

const state: { member: { id: string; name: string; role: string } | null; tables: Record<string, Row[]> } = { member: null, tables: {} }

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: async () => state.member }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeDb(state.tables) }))

import { advanceSpecialRequest, markChargeCollected } from '@/actions/followups'

const CHARGE = '00000000-0000-0000-0000-0000000c0001'
const REQUEST = '00000000-0000-0000-0000-0000000a0001'
const admin = { id: 'm-diego', name: 'Diego', role: 'admin' }
const cleaner = { id: 'm-ana', name: 'Ana', role: 'cleaning' }

beforeEach(() => {
  state.tables = {
    reservation_charges: [{ id: CHARGE, reservation_id: 'r1', concept: 'Adicional estadía', amount: 500000, due_date: '2027-01-09', status: 'pending', notes: '', version: 1 }],
    special_requests: [{ id: REQUEST, reservation_id: 'r2', kind: 'crib', description: 'Cuna', status: 'registered', version: 1 }],
  }
})

describe('marcar cobro adicional como cobrado desde la app', () => {
  it('solo un administrador puede hacerlo', async () => {
    state.member = cleaner
    expect(await markChargeCollected(CHARGE, 1, 'ref 1')).toMatchObject({ success: false })
    expect(state.tables.reservation_charges[0].status).toBe('pending')
  })

  it('exige la referencia del pago', async () => {
    state.member = admin
    expect(await markChargeCollected(CHARGE, 1, '   ')).toMatchObject({ success: false })
  })

  it('guarda quién, por dónde y la confirmación; con versión vieja no pisa', async () => {
    state.member = admin
    expect(await markChargeCollected(CHARGE, 1, 'Transferencia SINT-1')).toEqual({ success: true })
    expect(state.tables.reservation_charges[0]).toMatchObject({
      status: 'collected', confirmation: 'Transferencia SINT-1', updated_by: 'm-diego', updated_via: 'app', version: 2,
    })
    const stale = await markChargeCollected(CHARGE, 1, 'otra')
    expect(stale).toMatchObject({ success: false, error: expect.stringContaining('cambió') })
  })
})

describe('solicitud especial desde la app', () => {
  it('limpieza avisa y después confirma que quedó lista, con su nombre', async () => {
    state.member = cleaner
    expect(await advanceSpecialRequest(REQUEST, 1, 'notified', 'Le avisé a Diego')).toEqual({ success: true })
    expect(state.tables.special_requests[0]).toMatchObject({ status: 'notified', notified_note: 'Le avisé a Diego' })
    expect(state.tables.special_requests[0].ready_at).toBeUndefined()
    expect(await advanceSpecialRequest(REQUEST, 2, 'ready', 'cuna armada y revisada')).toEqual({ success: true })
    expect(state.tables.special_requests[0]).toMatchObject({
      status: 'ready', ready_by: 'm-ana', ready_confirmation: 'Ana: cuna armada y revisada', updated_via: 'app',
    })
  })

  it('sin sesión no cambia nada', async () => {
    state.member = null
    expect(await advanceSpecialRequest(REQUEST, 1, 'ready', 'lista')).toMatchObject({ success: false })
    expect(state.tables.special_requests[0].status).toBe('registered')
  })
})
