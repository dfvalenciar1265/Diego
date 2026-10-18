// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'
import { PENDING, rulesTemplate, validateRulesFile, validateUnitRules } from '@/lib/public-availability/rules-input'
import { toRules } from '@/lib/public-availability/source'

const ANSWERED = {
  slug: 'tocahagua-708',
  min_nights: 2, max_nights: null, date_overrides: [{ from: '2026-12-15', to: '2027-01-10', min_nights: 3, check_in_days: [5, 6] }],
  advance_notice_hours: 24, booking_window_days: 365, preparation_nights: 0, same_day_turnover: true, turnover_hours: 4,
  check_in_days: null, check_out_days: null, check_in_time: '15:00', check_out_time: '11:00',
  source_note: 'Airbnb > Disponibilidad (sintético)',
}

describe('archivo de reglas', () => {
  it('la plantilla no trae ningún valor: todo PENDIENTE y no se puede verificar', () => {
    const t = rulesTemplate(CASA_BLUE_CATALOG)
    expect(t.apartamentos).toHaveLength(8)
    for (const a of t.apartamentos) {
      for (const [k, v] of Object.entries(a)) if (k !== 'slug') expect(v).toBe(PENDING)
    }
    const { results } = validateRulesFile(t, CASA_BLUE_CATALOG)
    expect(results.every(r => !r.ok)).toBe(true)
  })

  it('acepta un apartamento con todo contestado (null explícito = sin límite)', () => {
    const r = validateUnitRules(ANSWERED, 'pid')
    expect(r.ok).toBe(true)
    // Ida y vuelta: lo guardado se lee como reglas del cálculo.
    if (r.ok) {
      const rules = toRules({ ...r.row, check_in_time: '15:00:00', check_out_time: '11:00:00' })
      expect(rules).toMatchObject({ minNights: 2, maxNights: null, turnoverHours: 4, checkInTime: '15:00',
        dateOverrides: [{ from: '2026-12-15', to: '2027-01-10', minNights: 3, checkInDays: [5, 6] }] })
    }
  })

  it.each([
    ['un campo pendiente', { preparation_nights: PENDING }, /sin contestar: preparation_nights/],
    ['campo omitido', { same_day_turnover: undefined }, /sin contestar: same_day_turnover/],
    ['máximo menor que mínimo', { max_nights: 1 }, /max_nights/],
    ['hora mal escrita', { check_in_time: '3pm' }, /check_in_time/],
    ['días fuera de rango', { check_out_days: [7] }, /check_out_days/],
    ['días vacíos', { check_in_days: [] }, /check_in_days/],
    ['preparación excesiva', { preparation_nights: 9 }, /preparation_nights/],
    ['sin fuente', { source_note: '' }, /source_note/],
    ['campo inventado', { precio: 100 }, /campos no admitidos: precio/],
    ['ajuste sin cambios', { date_overrides: [{ from: '2026-12-01', to: '2026-12-31' }] }, /no cambia ninguna regla/],
    ['ajuste con campo no admitido', { date_overrides: [{ from: '2026-12-01', to: '2026-12-31', preparation_nights: 2 }] }, /no admitido/],
    ['ajuste con fechas al revés', { date_overrides: [{ from: '2026-12-31', to: '2026-12-01', min_nights: 2 }] }, /from\/to/],
  ])('rechaza %s', (_, over, msg) => {
    const raw: Record<string, unknown> = { ...ANSWERED, ...over }
    for (const k of Object.keys(raw)) if (raw[k] === undefined) delete raw[k]
    const r = validateUnitRules(raw, 'pid')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.join(' | ')).toMatch(msg)
  })

  it('rechaza slugs desconocidos o repetidos en el archivo', () => {
    const { fileErrors } = validateRulesFile({ apartamentos: [ANSWERED, ANSWERED, { ...ANSWERED, slug: 'otro' }] }, CASA_BLUE_CATALOG)
    expect(fileErrors).toEqual(['slug repetido: tocahagua-708', 'slug desconocido: otro'])
  })
})
