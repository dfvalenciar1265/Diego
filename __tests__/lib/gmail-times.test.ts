import { describe, expect, it, vi } from 'vitest'
import { importEmailTimes, parseEmailTimeFacts } from '@/lib/gmail-times'
import { fakeDb } from '../helpers/fake-db'
import { timingReservation as r } from '../helpers/timing'

describe('horarios de Gmail', () => {
  it('horarios genéricos no se convierten en ETA ni autorización', () => {
    expect(parseEmailTimeFacts('Check-in: 9am\nCheck-out: 12pm')).toEqual([
      { direction: 'checkin', kind: 'platform', time: '09:00' }, { direction: 'checkout', kind: 'platform', time: '12:00' },
    ])
    expect(parseEmailTimeFacts('Mi llegada es a las 9am\nHora estimada de salida: 25:00')).toEqual([])
  })
  it('separa llegada y salida solo cuando la etiqueta dice explícitamente estimada', () => {
    expect(parseEmailTimeFacts('Hora estimada de llegada: 09:30\nETA salida: 10am')).toEqual([
      { direction: 'checkin', kind: 'estimate', time: '09:30' }, { direction: 'checkout', kind: 'estimate', time: '10:00' },
    ])
  })
  it('importar/reintentar usa la misma clave del mensaje y las fechas originales, sin tocar notas', async () => {
    const rpc = vi.fn<(name: string, args: Record<string, unknown>) => { data: object; error: null }>(() => ({ data: {}, error: null }))
    const tables = { tasks: [{ notes: '13:00|Manual' }], reservations: [{ ...r, notes: 'Nota manual' }] }
    const db = fakeDb(tables, { rpc })
    const email = { reference: 'synthetic-message-1', observed_at: '2026-10-30T03:30:00Z', facts: parseEmailTimeFacts('ETA llegada: 09:00') }
    await importEmailTimes(db, r, email)
    await importEmailTimes(db, r, email)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_source: 'gmail', p_kind: 'estimate', p_actor_id: null,
      p_stay_check_in: r.check_in, p_stay_check_out: r.check_out, p_observed_at: email.observed_at })
    expect(tables.tasks[0].notes).toBe('13:00|Manual')
    expect(tables.reservations[0].notes).toBe('Nota manual')
  })
  it('un error de importación no se informa como éxito', async () => {
    const db = fakeDb({}, { rpc: () => ({ data: null, error: { message: 'Error sintético' } }) })
    await expect(importEmailTimes(db, r, { reference: 'synthetic-2', observed_at: '2026-10-30T03:30:00Z', facts: parseEmailTimeFacts('Check-in: 3pm') })).rejects.toThrow('requiere revisión')
  })
})
