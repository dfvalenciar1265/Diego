// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { CASA_BLUE_CATALOG } from '@/lib/public-availability/catalog'
import { computeAvailability, evaluateUnit, isoInstant } from '@/lib/public-availability/compute'
import { COVERAGE, NOW, RULES, snapshot, unit } from './fixtures'
import type { AvailabilityQuery } from '@/lib/public-availability/query'

const Q = { arrival: '2026-11-10', departure: '2026-11-13', guests: 2 }
const statusOf = (res: ReturnType<typeof computeAvailability>, slug: string) => res.apartments.find(a => a.slug === slug)!.status
const evalWith = (over: Parameters<typeof unit>[1], q: AvailabilityQuery = Q, now = NOW) => evaluateUnit(unit('conquistador-1821', over), q, COVERAGE, now)

describe('catálogo', () => {
  it('tiene los ocho apartamentos confirmados, sin duplicados, con sus capacidades', () => {
    expect(CASA_BLUE_CATALOG.map(u => [u.slug, u.capacity])).toEqual([
      ['mar-adentro-1305', 6], ['torres-del-lago-1303', 8], ['crespo-1214', 4], ['conquistador-1821', 8],
      ['marina-del-rey-1104', 5], ['palmetto-1001', 6], ['tocahagua-1208', 4], ['tocahagua-708', 4],
    ])
    expect(new Set(CASA_BLUE_CATALOG.map(u => u.slug)).size).toBe(8)
    expect(new Set(CASA_BLUE_CATALOG.map(u => u.propertyId)).size).toBe(8)
  })
})

describe('computeAvailability: forma de la respuesta', () => {
  it('devuelve siempre los ocho, una vez y en orden, sin IDs internos', () => {
    // La fuente trae las unidades desordenadas, una repetida y una que sobra.
    const snap = snapshot()
    if (snap.kind !== 'data') throw new Error()
    snap.units = [...snap.units].reverse()
    snap.units.push(unit('tocahagua-708'), { ...unit('conquistador-1821'), slug: 'otra-cosa' })
    const res = computeAvailability(Q, snap, NOW)
    expect(res.apartments.map(a => a.slug)).toEqual(CASA_BLUE_CATALOG.map(u => u.slug))
    expect(statusOf(res, 'tocahagua-708')).toBe('unknown')   // repetida en la fuente
    const json = JSON.stringify(res)
    for (const u of CASA_BLUE_CATALOG) expect(json).not.toContain(u.propertyId)
    expect(Object.keys(res).sort()).toEqual(['apartments', 'coverage', 'lastSyncedAt', 'queriedAt', 'query', 'sourceStatus'])
  })

  it('usa instantes ISO con segundos y zona; queriedAt es el reloj de la consulta', () => {
    const res = computeAvailability(Q, snapshot(), NOW)
    expect(res.queriedAt).toBe('2026-10-18T06:30:00Z')
    expect(res.lastSyncedAt).toBe('2026-10-18T06:25:00Z')
    expect(isoInstant(new Date('2026-10-18T06:30:05.123Z'))).toBe('2026-10-18T06:30:05Z')
    expect(res.sourceStatus).toBe('ready')
    expect(res.coverage).toEqual(COVERAGE)
    expect(res.query).toEqual(Q)
  })
})

describe('computeAvailability: estado de la fuente', () => {
  const allUnknown = (res: ReturnType<typeof computeAvailability>) => res.apartments.every(a => a.status === 'unknown')

  it('fuente ausente o caída → unconfigured/unavailable, nulls y todo unknown', () => {
    for (const status of ['unconfigured', 'unavailable', 'incomplete'] as const) {
      const res = computeAvailability(Q, { kind: 'problem', status, reason: 'x' }, NOW)
      expect(res).toMatchObject({ sourceStatus: status, lastSyncedAt: null, coverage: null })
      expect(allUnknown(res)).toBe(true)
      expect(JSON.stringify(res)).not.toContain('reason')
    }
  })

  it('sincronización antigua (>900 s) → stale', () => {
    const res = computeAvailability(Q, snapshot({}, { lastSyncedAt: '2026-10-18T06:14:59Z' }), NOW)
    expect(res.sourceStatus).toBe('stale')
    expect(allUnknown(res)).toBe(true)
    expect(computeAvailability(Q, snapshot({}, { lastSyncedAt: '2026-10-18T06:15:00Z' }), NOW).sourceStatus).toBe('ready')
  })

  it('sincronización más de 60 s en el futuro → no es ready', () => {
    expect(computeAvailability(Q, snapshot({}, { lastSyncedAt: '2026-10-18T06:31:01Z' }), NOW).sourceStatus).toBe('unavailable')
    expect(computeAvailability(Q, snapshot({}, { lastSyncedAt: '2026-10-18T06:31:00Z' }), NOW).sourceStatus).toBe('ready')
  })

  it('sin sincronización o sin cobertura → incomplete con nulls', () => {
    const noSync = computeAvailability(Q, snapshot({}, { lastSyncedAt: null }), NOW)
    expect(noSync).toMatchObject({ sourceStatus: 'incomplete', lastSyncedAt: null })
    const noCov = computeAvailability(Q, snapshot({}, { coverage: null }), NOW)
    expect(noCov).toMatchObject({ sourceStatus: 'incomplete', coverage: null })
    expect(allUnknown(noSync) && allUnknown(noCov)).toBe(true)
  })

  it('estadía fuera de cobertura → incomplete y todo unknown', () => {
    const res = computeAvailability({ arrival: '2027-04-28', departure: '2027-05-02', guests: 2 }, snapshot(), NOW)
    expect(res.sourceStatus).toBe('incomplete')
    expect(allUnknown(res)).toBe(true)
    // Sale justo el último día cubierto: sí está cubierta.
    expect(computeAvailability({ arrival: '2027-04-27', departure: '2027-04-30', guests: 2 }, snapshot(), NOW).sourceStatus).toBe('ready')
  })

  it('una fuente caída nunca se convierte en "todo ocupado"', () => {
    const res = computeAvailability(Q, { kind: 'problem', status: 'unavailable', reason: 'timeout' }, NOW)
    expect(res.apartments.some(a => a.status === 'occupied')).toBe(false)
  })
})

describe('evaluateUnit: fechas y solapamientos', () => {
  it('libre y con reglas verificadas → available', () => {
    expect(evalWith({})).toBe('available')
  })

  it('solapamiento [arrival, departure) → occupied', () => {
    expect(evalWith({ periods: [{ start: '2026-11-12', end: '2026-11-15' }] })).toBe('occupied')
    expect(evalWith({ periods: [{ start: '2026-11-05', end: '2026-11-11' }] })).toBe('occupied')
    expect(evalWith({ periods: [{ start: '2026-11-11', end: '2026-11-12' }] })).toBe('occupied')
    expect(evalWith({ periods: [{ start: '2026-11-01', end: '2026-11-30' }] })).toBe('occupied')
  })

  it('el día de salida no es una noche: periodos que tocan los bordes no solapan', () => {
    // Otro sale el día que llego y otro llega el día que salgo (entrada/salida el mismo día permitida).
    expect(evalWith({ periods: [{ start: '2026-11-07', end: '2026-11-10' }, { start: '2026-11-13', end: '2026-11-16' }] })).toBe('available')
  })

  it('capacidad: más huéspedes que la capacidad confirmada → occupied', () => {
    expect(evaluateUnit(unit('tocahagua-708'), { ...Q, guests: 5 }, COVERAGE, NOW)).toBe('occupied')
    expect(evaluateUnit(unit('tocahagua-708'), { ...Q, guests: 4 }, COVERAGE, NOW)).toBe('available')
  })

  it('conflicto de catálogo → nunca available (unknown), salvo ocupación confirmada', () => {
    const conflicts = ['capacidad 6 en AirAdmin vs 8 en el catálogo']
    expect(evalWith({ conflicts })).toBe('unknown')
    expect(evalWith({ conflicts }, { ...Q, guests: 8 })).toBe('unknown')
    expect(evalWith({ conflicts, periods: [{ start: '2026-11-11', end: '2026-11-12' }] })).toBe('occupied')
  })

  it('sin reglas verificadas → unknown aunque esté libre', () => {
    expect(evalWith({ rules: null })).toBe('unknown')
  })
})

describe('evaluateUnit: bloqueos, cambios y cancelaciones', () => {
  it('un bloqueo (reserva directa) ocupa igual que una reserva', () => {
    expect(evalWith({ periods: [{ start: '2026-11-09', end: '2026-11-11' }] })).toBe('occupied')
  })

  it('una cancelación efectiva no llega como periodo: la unidad queda libre', () => {
    // El cargador excluye status=cancelled; aquí solo queda lo vigente.
    expect(evalWith({ periods: [] })).toBe('available')
  })

  it('cambio de fechas pendiente que cae en la estadía → unknown', () => {
    expect(evalWith({ periods: [{ start: '2026-11-20', end: '2026-11-23', alternate: { start: '2026-11-11', end: '2026-11-14' } }] })).toBe('unknown')
    // Cambio que no toca la estadía: no afecta.
    expect(evalWith({ periods: [{ start: '2026-11-20', end: '2026-11-23', alternate: { start: '2026-11-21', end: '2026-11-25' } }] })).toBe('available')
  })

  it('reserva con fechas por verificar (⚠️) → unknown', () => {
    expect(evalWith({ periods: [{ start: '2026-12-01', end: '2026-12-04', datesUncertain: true }] })).toBe('unknown')
  })
})

describe('evaluateUnit: reglas', () => {
  it('mínimo y máximo de noches', () => {
    expect(evalWith({}, { ...Q, departure: '2026-11-11' })).toBe('occupied')
    expect(evalWith({}, { ...Q, departure: '2026-12-11' })).toBe('occupied')
  })

  it('mínimo por fecha de llegada (conjuntos de reglas)', () => {
    const rules = { ...RULES, dateOverrides: [{ from: '2026-11-01', to: '2026-11-15', minNights: 4 }] }
    expect(evalWith({ rules })).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, minNights: 3, dateOverrides: [{ from: '2026-11-10', to: '2026-11-10', minNights: 1 }] } }, { ...Q, departure: '2026-11-11' })).toBe('available')
  })

  it('ajustes por fecha: días de llegada, máximo y preaviso solo para esas llegadas', () => {
    const rules = { ...RULES, dateOverrides: [{ from: '2026-11-01', to: '2026-11-30', checkInDays: [5, 6], maxNights: 2 }] }
    expect(evalWith({ rules })).toBe('occupied')                                              // martes, fuera de vie/sáb
    expect(evalWith({ rules }, { arrival: '2026-11-13', departure: '2026-11-15', guests: 2 })).toBe('available')
    expect(evalWith({ rules }, { arrival: '2026-11-13', departure: '2026-11-16', guests: 2 })).toBe('occupied') // 3 > máx 2
    expect(evalWith({ rules }, { arrival: '2026-12-01', departure: '2026-12-03', guests: 2 })).toBe('available') // fuera del ajuste
    const notice = { ...RULES, dateOverrides: [{ from: '2026-10-18', to: '2026-10-18', advanceNoticeHours: 48 }] }
    expect(evalWith({ rules: notice }, { arrival: '2026-10-18', departure: '2026-10-20', guests: 2 })).toBe('occupied')
    // Un ajuste puede quitar una restricción con null explícito.
    const open = { ...RULES, checkInDays: [5], dateOverrides: [{ from: '2026-11-10', to: '2026-11-10', checkInDays: null }] }
    expect(evalWith({ rules: open })).toBe('available')
  })

  it('días permitidos de entrada y salida', () => {
    // 10-nov-2026 es martes (2); 13-nov es viernes (5).
    expect(evalWith({ rules: { ...RULES, checkInDays: [5, 6] } })).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, checkInDays: [2] } })).toBe('available')
    expect(evalWith({ rules: { ...RULES, checkOutDays: [0] } })).toBe('occupied')
  })

  it('ventana de reserva', () => {
    expect(evalWith({ rules: { ...RULES, bookingWindowDays: 20 } })).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, bookingWindowDays: 25 } })).toBe('available')
  })

  it('preaviso en horas, contra la hora de entrada en Bogotá', () => {
    const today = { arrival: '2026-10-18', departure: '2026-10-20', guests: 2 }
    // Entrada a las 15:00 de Bogotá = 20:00 UTC; ahora son las 06:30 UTC → faltan 13,5 h.
    expect(evalWith({ rules: { ...RULES, advanceNoticeHours: 24 } }, today)).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, advanceNoticeHours: 12 } }, today)).toBe('available')
    expect(evalWith({ rules: { ...RULES, advanceNoticeHours: 12, checkInTime: null } }, today)).toBe('unknown')
  })

  it('preaviso "mismo día": la llegada de hoy no se confirma (Airbnb tiene una hora límite que no guardamos)', () => {
    const today = { arrival: '2026-10-18', departure: '2026-10-20' }
    expect(evalWith({ rules: { ...RULES, advanceNoticeHours: 0 } }, today)).toBe('unknown')
    // Ocupación confirmada sigue siendo occupied, y mañana ya se puede confirmar.
    expect(evalWith({ rules: { ...RULES, advanceNoticeHours: 0 }, periods: [{ start: '2026-10-18', end: '2026-10-19' }] }, today)).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, advanceNoticeHours: 0 } }, { arrival: '2026-10-19', departure: '2026-10-21' })).toBe('available')
  })

  it('preparación: bloquea noches vecinas', () => {
    const rules = { ...RULES, preparationNights: 1 }
    expect(evalWith({ rules, periods: [{ start: '2026-11-07', end: '2026-11-10' }] })).toBe('occupied')
    expect(evalWith({ rules, periods: [{ start: '2026-11-13', end: '2026-11-16' }] })).toBe('occupied')
    // Con una noche libre entre medias (9 y 13) sí cabe.
    expect(evalWith({ rules, periods: [{ start: '2026-11-06', end: '2026-11-09' }, { start: '2026-11-14', end: '2026-11-16' }] })).toBe('available')
  })

  it('preparación sin cobertura de los vecinos → unknown', () => {
    const rules = { ...RULES, preparationNights: 2 }
    const q = { arrival: '2026-10-19', departure: '2026-10-21', guests: 2 }
    expect(evaluateUnit(unit('conquistador-1821', { rules }), q, { from: '2026-10-18', to: '2027-04-30' }, NOW)).toBe('unknown')
    expect(evaluateUnit(unit('conquistador-1821', { rules }), q, { from: '2026-10-17', to: '2027-04-30' }, NOW)).toBe('available')
  })

  it('sin preparación ni restricciones de cambio de huésped no exige una noche anterior innecesaria', () => {
    expect(evaluateUnit(unit('conquistador-1821'), Q, {from: Q.arrival, to: Q.departure}, NOW)).toBe('available')
  })

  it('restricciones de cambio el mismo día exigen cobertura de ambas noches vecinas', () => {
    for (const rules of [{...RULES, sameDayTurnover:false}, {...RULES, turnoverHours:4}]) {
      const u = unit('conquistador-1821', {rules})
      expect(evaluateUnit(u, Q, {from:'2026-11-09',to:Q.departure}, NOW)).toBe('unknown')
      expect(evaluateUnit(u, Q, {from:Q.arrival,to:'2026-11-14'}, NOW)).toBe('unknown')
      expect(evaluateUnit(u, Q, {from:'2026-11-09',to:'2026-11-14'}, NOW)).toBe('available')
    }
  })

  it('entrada/salida el mismo día solo si la unidad lo permite', () => {
    const touching = [{ start: '2026-11-07', end: '2026-11-10' }]
    expect(evalWith({ rules: { ...RULES, sameDayTurnover: false }, periods: touching })).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, sameDayTurnover: false }, periods: [{ start: '2026-11-13', end: '2026-11-15' }] })).toBe('occupied')
    expect(evalWith({ rules: { ...RULES, sameDayTurnover: true }, periods: touching })).toBe('available')
  })

  it('entrada/salida el mismo día con precisión por horas', () => {
    const rules = { ...RULES, turnoverHours: 4 }
    // Sale a las 11:00, entro a las 15:00 → 4 h justas.
    expect(evalWith({ rules, periods: [{ start: '2026-11-07', end: '2026-11-10' }] })).toBe('available')
    // Esa reserva tiene salida tardía a las 13:00 → 2 h.
    expect(evalWith({ rules, periods: [{ start: '2026-11-07', end: '2026-11-10', endTime: '13:00' }] })).toBe('occupied')
    // Sin hora de entrada conocida no se puede confirmar.
    expect(evalWith({ rules: { ...rules, checkInTime: null }, periods: [{ start: '2026-11-07', end: '2026-11-10' }] })).toBe('unknown')
  })
})
