import { describe, it, expect } from 'vitest'
import {
  parseCompareBody, parseRange, parseNewMaintenance, parseMaintenancePatch,
  parseMaintenanceFilter, isUuid, parseTurnoverDate, parseTimeChange,
} from '@/lib/gpt-api/validate'

const item = {
  code: ' hmabc 123 ', guest_name: 'Laura', property: 'Palmetto 1001',
  check_in: '2026-10-10', check_out: '2026-10-13', guests: 2,
}
const body = (over: Record<string, unknown> = {}) =>
  ({ from: '2026-10-08', to: '2026-10-30', reservations: [item], ...over })

describe('parseCompareBody', () => {
  it('accepts a valid list and normalizes codes', () => {
    expect(parseCompareBody(body({ to: '2026-12-07' }))).toEqual({
      ok: true,
      value: {
        from: '2026-10-08', to: '2026-12-07', dry_run: false,
        reservations: [{ ...item, code: 'HMABC123', status: 'confirmed' }],
      },
    })
  })

  it('passes dry_run through', () => {
    const r = parseCompareBody(body({ dry_run: true }))
    expect(r.ok && r.value.dry_run).toBe(true)
  })

  it('refuses an empty list', () => {
    expect(parseCompareBody(body({ reservations: [] }))).toEqual({
      ok: false, error: 'La lista de Airbnb llegó vacía; no comparo para no marcar todo como faltante.',
    })
  })

  it('refuses ranges longer than 120 days', () => {
    expect(parseCompareBody(body({ to: '2027-02-06' })).ok).toBe(false)
    expect(parseCompareBody(body({ to: '2027-02-05' })).ok).toBe(true)
  })

  it('says which reservation is wrong', () => {
    expect(parseCompareBody(body({ reservations: [item, { ...item, check_out: '2026-10-10' }] }))).toEqual({
      ok: false, error: 'Reserva #2: "check_out" debe ser posterior a "check_in".',
    })
  })

  it('rejects impossible dates, unknown statuses and fractional guests', () => {
    expect(parseCompareBody(body({ from: '2026-02-30' })).ok).toBe(false)
    expect(parseCompareBody(body({ reservations: [{ ...item, status: 'pending' }] })).ok).toBe(false)
    expect(parseCompareBody(body({ reservations: [{ ...item, guests: 2.5 }] })).ok).toBe(false)
  })

  it('caps the list at 300 bookings', () => {
    expect(parseCompareBody(body({ reservations: Array.from({ length: 301 }, () => item) })).ok).toBe(false)
  })
})

describe('parseRange', () => {
  it('defaults to today plus 60 days', () => {
    expect(parseRange(null, null, '2026-10-08')).toEqual({ ok: true, value: { from: '2026-10-08', to: '2026-12-07' } })
  })

  it('rejects a range that ends before it starts', () => {
    expect(parseRange('2026-10-10', '2026-10-01', '2026-10-08')).toEqual({
      ok: false, error: '"to" no puede ser anterior a "from".',
    })
  })
})

describe('parseNewMaintenance', () => {
  it('accepts a valid issue', () => {
    expect(parseNewMaintenance({ property: 'Palmetto 1001', title: 'Desagüe lento', priority: 'urgent' })).toEqual({
      ok: true, value: { property: 'Palmetto 1001', title: 'Desagüe lento', description: '', priority: 'urgent' },
    })
  })

  it('requires a known priority and a title', () => {
    expect(parseNewMaintenance({ property: 'Palmetto 1001', title: 'x', priority: 'alta' })).toEqual({
      ok: false, error: '"priority" debe ser "urgent", "normal" o "scheduled".',
    })
    expect(parseNewMaintenance({ property: 'Palmetto 1001', title: '  ', priority: 'normal' })).toEqual({
      ok: false, error: 'Falta "title".',
    })
  })
})

describe('parseMaintenancePatch', () => {
  it('accepts status, note and cost', () => {
    expect(parseMaintenancePatch({ status: 'resolved', note: 'Listo', cost: 80000 })).toEqual({
      ok: true, value: { status: 'resolved', note: 'Listo', cost: 80000 },
    })
  })

  it('needs at least one change', () => {
    expect(parseMaintenancePatch({})).toEqual({ ok: false, error: 'Envía al menos "status", "note" o "cost".' })
  })

  it('rejects negative costs and unknown statuses', () => {
    expect(parseMaintenancePatch({ cost: -1 }).ok).toBe(false)
    expect(parseMaintenancePatch({ status: 'closed' }).ok).toBe(false)
  })
})

describe('parseMaintenanceFilter', () => {
  it('defaults to active and accepts the known statuses', () => {
    expect(parseMaintenanceFilter(null)).toEqual({ ok: true, value: 'active' })
    expect(parseMaintenanceFilter('resolved')).toEqual({ ok: true, value: 'resolved' })
    expect(parseMaintenanceFilter('closed').ok).toBe(false)
  })
})

describe('isUuid', () => {
  it('recognizes Supabase ids', () => {
    expect(isUuid('2be6deec-8061-453e-b1ae-ce0bd177fadd')).toBe(true)
    expect(isUuid('123')).toBe(false)
  })
})

describe('parseTurnoverDate', () => {
  it('defaults to today and accepts up to 30 days ahead', () => {
    expect(parseTurnoverDate(null, '2026-10-10')).toEqual({ ok: true, value: '2026-10-10' })
    expect(parseTurnoverDate('2026-11-09', '2026-10-10')).toEqual({ ok: true, value: '2026-11-09' })
  })

  it('rejects the past, far dates and bad formats', () => {
    expect(parseTurnoverDate('2026-10-09', '2026-10-10')).toEqual({ ok: false, error: 'Solo se pueden ver o cambiar horas de hoy en adelante.' })
    expect(parseTurnoverDate('2026-11-10', '2026-10-10').ok).toBe(false)
    expect(parseTurnoverDate('10/10/2026', '2026-10-10').ok).toBe(false)
  })
})

describe('parseTimeChange', () => {
  it('reads apartment, time, optional date and guest', () => {
    expect(parseTimeChange({ property: 'Palmetto 1001', time: '10am' }, '2026-10-10')).toEqual({
      ok: true, value: { property: 'Palmetto 1001', time: '10:00', date: '2026-10-10', guest_name: null },
    })
    expect(parseTimeChange({ property: 'Palmetto 1001', time: '6:30 pm', date: '2026-10-11', guest_name: 'Laura' }, '2026-10-10')).toEqual({
      ok: true, value: { property: 'Palmetto 1001', time: '18:30', date: '2026-10-11', guest_name: 'Laura' },
    })
  })

  it('explains what is wrong', () => {
    expect(parseTimeChange({ property: 'Palmetto 1001', time: 'tarde' }, '2026-10-10')).toEqual({
      ok: false, error: '"time" debe ser una hora como 10am, 3:30 pm o 15:30.',
    })
    expect(parseTimeChange({ time: '10am' }, '2026-10-10')).toEqual({ ok: false, error: 'Falta "property".' })
    expect(parseTimeChange({ property: 'Palmetto 1001', time: '10am', date: 20261011 }, '2026-10-10').ok).toBe(false)
  })
})
