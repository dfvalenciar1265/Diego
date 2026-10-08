import { describe, it, expect } from 'vitest'
import { compareReservations, type AppReservation } from '@/lib/gpt-api/compare'
import type { AirbnbReservationInput } from '@/lib/gpt-api/validate'

const PROPS = [
  { id: 'p1001', name: 'Palmetto 1001' },
  { id: 'p708', name: 'Tocahagua 708' },
]

const appRow = (over: Partial<AppReservation> = {}): AppReservation => ({
  id: 'r1', airbnb_code: 'HMAAA111', guest_name: 'Laura Gómez', property_id: 'p1001',
  check_in: '2026-10-10', check_out: '2026-10-13', guests: 2,
  status: 'confirmed', source: 'airbnb', notes: '', ...over,
})

const bnb = (over: Partial<AirbnbReservationInput> = {}): AirbnbReservationInput => ({
  code: 'HMAAA111', guest_name: 'Laura Gómez', property: 'Palmetto 1001',
  check_in: '2026-10-10', check_out: '2026-10-13', guests: 2, status: 'confirmed', ...over,
})

const run = (items: AirbnbReservationInput[], rows: AppReservation[]) =>
  compareReservations({ from: '2026-10-08', to: '2026-11-07', dry_run: false, reservations: items }, rows, PROPS)

describe('compareReservations', () => {
  it('reports nothing when Airbnb and the app agree', () => {
    const r = run([bnb()], [appRow()])
    expect(r.differences).toEqual([])
    expect(r.matching_ids).toEqual(['r1'])
    expect(r.summary).toEqual({ airbnb: 1, app: 1, matching: 1, differences: 0, unmatched: 0 })
  })

  it('flags a changed check-out with a readable message', () => {
    const r = run([bnb()], [appRow({ check_out: '2026-10-12' })])
    expect(r.differences).toHaveLength(1)
    expect(r.differences[0]).toMatchObject({
      types: ['dates_differ'], code: 'HMAAA111', reservation_id: 'r1', property: 'Palmetto 1001',
      message: 'Salida 13-oct en Airbnb, 12-oct en la app',
    })
  })

  it('joins several differences of one booking in a single message', () => {
    const r = run([bnb({ check_in: '2026-10-09', guests: 3 })], [appRow()])
    expect(r.differences[0].types).toEqual(['dates_differ', 'guests_differ'])
    expect(r.differences[0].message).toBe('Llegada 9-oct en Airbnb, 10-oct en la app; 3 huéspedes en Airbnb, 2 en la app')
  })

  it('ignores the guest count when one side does not have it', () => {
    expect(run([bnb({ guests: null })], [appRow()]).differences).toEqual([])
    expect(run([bnb()], [appRow({ guests: null })]).differences).toEqual([])
  })

  it('flags a booking cancelled in Airbnb that is still confirmed in the app', () => {
    const r = run([bnb({ status: 'cancelled' })], [appRow()])
    expect(r.differences[0]).toMatchObject({
      types: ['cancelled_in_airbnb'], reservation_id: 'r1',
      message: 'Cancelada en Airbnb; en la app sigue confirmada',
    })
  })

  it('treats cancelled on both sides as matching', () => {
    const r = run([bnb({ status: 'cancelled' })], [appRow({ status: 'cancelled' })])
    expect(r.differences).toEqual([])
    expect(r.summary.matching).toBe(1)
  })

  it('reports a confirmed Airbnb booking missing from the app, with nothing to mark', () => {
    const r = run([bnb({ code: 'HMZZZ999' })], [])
    expect(r.differences[0]).toMatchObject({ types: ['missing_in_app'], reservation_id: null, app: null })
    expect(r.differences[0].message).toContain('sincronización de Gmail')
  })

  it('reports as missing when the app only has it cancelled', () => {
    const r = run([bnb()], [appRow({ status: 'cancelled' })])
    expect(r.differences[0]).toMatchObject({ types: ['missing_in_app'], reservation_id: null })
    expect(r.differences[0].message).toContain('figura cancelada')
  })

  it('is fine with a cancelled Airbnb booking that the app does not have', () => {
    expect(run([bnb({ code: 'HMZZZ999', status: 'cancelled' })], []).differences).toEqual([])
  })

  it('matches by first name, apartment and dates when the code is missing', () => {
    const r = run([bnb({ code: null, guest_name: 'Laura' })], [appRow()])
    expect(r.differences).toEqual([])
    expect(r.matching_ids).toEqual(['r1'])
  })

  it('matches names regardless of accents and case', () => {
    expect(run([bnb({ code: null, guest_name: 'laura gomez' })], [appRow()]).differences).toEqual([])
  })

  it('does not name-match a booking that has a different code', () => {
    const r = run([bnb({ code: 'HMZZZ999' })], [appRow()])
    expect(r.differences.map(d => d.types[0]).sort()).toEqual(['missing_in_app', 'not_in_airbnb_list'])
  })

  it('leaves ambiguous name matches unmatched and does not flag the candidates', () => {
    const rows = [
      appRow({ airbnb_code: null }),
      appRow({ id: 'r2', airbnb_code: null, check_in: '2026-10-11', check_out: '2026-10-14' }),
    ]
    const r = run([bnb({ code: null, guest_name: 'Laura' })], rows)
    expect(r.unmatched).toHaveLength(1)
    expect(r.unmatched[0].reason).toBe('Hay 2 reservas de Laura en Palmetto 1001 que se cruzan con esas fechas')
    expect(r.differences).toEqual([])
  })

  it('flags a different apartment when matched by code', () => {
    const r = run([bnb({ property: 'Tocahagua 708' })], [appRow()])
    expect(r.differences[0]).toMatchObject({
      types: ['property_differ'],
      message: 'En Airbnb está en Tocahagua 708, en la app en Palmetto 1001',
    })
  })

  it('flags app bookings in the range that Airbnb did not list', () => {
    const r = run([bnb()], [
      appRow(),
      appRow({ id: 'r2', airbnb_code: 'HMBBB222', guest_name: 'Pedro', check_in: '2026-10-20', check_out: '2026-10-22' }),
    ])
    expect(r.differences).toHaveLength(1)
    expect(r.differences[0]).toMatchObject({ types: ['not_in_airbnb_list'], reservation_id: 'r2', code: 'HMBBB222' })
    expect(r.summary.app).toBe(2)
  })

  it('never flags blocks, direct bookings or stays outside the range', () => {
    const rows = [
      appRow(),
      appRow({ id: 'b1', airbnb_code: null, status: 'blocked', check_in: '2026-10-20', check_out: '2026-10-25' }),
      appRow({ id: 'd1', airbnb_code: null, source: 'direct', check_in: '2026-10-26', check_out: '2026-10-28' }),
      appRow({ id: 'o1', airbnb_code: 'HMOLD000', check_in: '2026-10-05', check_out: '2026-10-08' }),
    ]
    expect(run([bnb()], rows).differences).toEqual([])
  })

  it('cannot match an unknown apartment without a code', () => {
    const r = run([bnb({ code: null, property: 'Casa Toro' })], [appRow()])
    expect(r.unmatched[0].reason).toBe('No reconozco el apartamento «Casa Toro»')
  })

  it('reports a code that comes twice in the list', () => {
    const r = run([bnb(), bnb()], [appRow()])
    expect(r.unmatched[0].reason).toBe('El código HMAAA111 vino repetido en la lista')
  })
})
