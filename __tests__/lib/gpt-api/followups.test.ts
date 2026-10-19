import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  appendFollowupNote, bogotaDateTime, duplicateCharge, duplicateRequest, parseChargePatch, parseNewCharge,
  parseNewRequest, parseRequestPatch, requestIsLate, type ChargeRow, type RequestRow,
} from '@/lib/gpt-api/followups'
import {
  createChargeTool, createSpecialRequestTool, listFollowupsTool, turnoversTool, updateChargeTool, updateSpecialRequestTool,
} from '@/lib/gpt-api/service'
import { fakeDb, type Row } from '../../helpers/fake-db'

const RES = '00000000-0000-0000-0000-00000000e001'
const RES_OCT = '00000000-0000-0000-0000-00000000e002'
const ADMIN = { id: '00000000-0000-0000-0000-0000000000d1', via: 'mcp' as const }

describe('validación de cobros', () => {
  it('acepta el caso Torres 1303: $500.000 a cobrar el 9 de enero', () => {
    expect(parseNewCharge({ reservation_id: RES, concept: 'Adicional estadía', amount: 500000, due_date: '2027-01-09' }))
      .toEqual({ ok: true, value: { reservation_id: RES, concept: 'Adicional estadía', amount: 500000, due_date: '2027-01-09', notes: '' } })
  })

  it('rechaza montos en cero, conceptos vacíos y reservas sin id', () => {
    expect(parseNewCharge({ reservation_id: RES, concept: 'x y', amount: 0 }).ok).toBe(false)
    expect(parseNewCharge({ reservation_id: RES, concept: '', amount: 10 }).ok).toBe(false)
    expect(parseNewCharge({ reservation_id: 'HM123', concept: 'Extra', amount: 10 }).ok).toBe(false)
  })

  it('no da por cobrado sin confirmación ni con fecha futura', () => {
    const base = { id: RES, expected_version: 1, status: 'collected' }
    expect(parseChargePatch(base, '2027-01-09').ok).toBe(false)
    expect(parseChargePatch({ ...base, confirmation: 'ref 1', collected_on: '2027-01-10' }, '2027-01-09').ok).toBe(false)
    expect(parseChargePatch({ ...base, confirmation: 'ref 1' }, '2027-01-09'))
      .toEqual({ ok: true, value: { ...base, confirmation: 'ref 1', collected_on: '2027-01-09' } })
  })

  it('exige la versión leída y un motivo para anular', () => {
    expect(parseChargePatch({ id: RES, status: 'void', void_reason: 'x' }, '2027-01-09').ok).toBe(false)
    expect(parseChargePatch({ id: RES, expected_version: 2, status: 'void' }, '2027-01-09').ok).toBe(false)
    expect(parseChargePatch({ id: RES, expected_version: 2 }, '2027-01-09').ok).toBe(false)
  })
})

describe('validación de solicitudes', () => {
  it('guarda la hora límite en hora de Colombia', () => {
    expect(bogotaDateTime('2026-10-23', '07:00')).toBe('2026-10-23T07:00:00-05:00')
    const parsed = parseNewRequest({ reservation_id: RES_OCT, kind: 'crib', description: 'Cuna', due_date: '2026-10-23', due_time: '07:00' })
    expect(parsed.ok && parsed.value.due_at).toBe('2026-10-23T07:00:00-05:00')
  })

  it('avisar exige a quién; lista exige la confirmación de que quedó hecha', () => {
    expect(parseRequestPatch({ id: RES, expected_version: 1, status: 'notified' }).ok).toBe(false)
    expect(parseRequestPatch({ id: RES, expected_version: 1, status: 'ready' }).ok).toBe(false)
    expect(parseRequestPatch({ id: RES, expected_version: 1, status: 'ready', ready_confirmation: 'Ana: cuna armada' }).ok).toBe(true)
    expect(parseRequestPatch({ id: RES, expected_version: 1, status: 'registered' }).ok).toBe(false)
  })

  it('una solicitud abierta con la hora límite pasada está atrasada; lista no', () => {
    const now = new Date('2026-10-23T14:00:00Z')
    expect(requestIsLate({ status: 'notified', due_at: '2026-10-23T07:00:00-05:00' }, now)).toBe(true)
    expect(requestIsLate({ status: 'ready', due_at: '2026-10-23T07:00:00-05:00' }, now)).toBe(false)
  })
})

describe('duplicados', () => {
  const charge = { id: 'c1', reservation_id: RES, concept: 'Adicional estadía', due_date: '2027-01-09', status: 'pending' } as ChargeRow
  it('el mismo concepto y fecha es el mismo cobro, sin importar mayúsculas ni espacios', () => {
    expect(duplicateCharge([charge], { reservation_id: RES, concept: ' ADICIONAL estadía ', due_date: '2027-01-09' })).toBe(charge)
    expect(duplicateCharge([charge], { reservation_id: RES, concept: 'Adicional estadía', due_date: '2027-01-10' })).toBeNull()
    expect(duplicateCharge([{ ...charge, status: 'void' }], { reservation_id: RES, concept: 'Adicional estadía', due_date: '2027-01-09' })).toBeNull()
  })

  it('una cuna por reserva; las "other" se distinguen por descripción', () => {
    const crib = { id: 'q1', reservation_id: RES_OCT, kind: 'crib', description: 'Cuna', status: 'notified' } as RequestRow
    expect(duplicateRequest([crib], { reservation_id: RES_OCT, kind: 'crib', description: 'Otra cuna' })).toBe(crib)
    const other = { ...crib, kind: 'other' as const, description: 'Toallas extra' }
    expect(duplicateRequest([other], { reservation_id: RES_OCT, kind: 'other', description: 'Almohadas' })).toBeNull()
  })

  it('las notas solo se agregan', () => {
    expect(appendFollowupNote('Acordado por chat', 'Confirmó transferencia', '2027-01-09')).toBe('Acordado por chat\n[9-ene] Confirmó transferencia')
  })
})

// ── Servicio sobre una base en memoria (imita lo que hace PostgREST y los triggers) ─────────────

function baseTables() {
  return {
    properties: [{ id: 'p1303', name: 'Torres 1303', active: true }],
    team_members: [{ id: 'm-ana', name: 'Ana Limpieza', active: true }],
    reservations: [
      { id: RES, property_id: 'p1303', source: 'airbnb', airbnb_code: 'HMSYNTH01', guest_name: 'Huésped Enero', check_in: '2027-01-02', check_out: '2027-01-09', guests: 8, amount: 7000000, notes: 'Check-in: 3pm | Check-out: 12pm', status: 'confirmed', tasks: [] },
      { id: RES_OCT, property_id: 'p1303', source: 'airbnb', airbnb_code: 'HMSYNTH02', guest_name: 'Huésped Octubre', check_in: '2026-10-24', check_out: '2026-10-26', guests: 2, amount: 900000, notes: '', status: 'confirmed', tasks: [] },
    ] as Row[],
    reservation_charges: [] as Row[],
    special_requests: [] as Row[],
  }
}

describe('cobros adicionales por el MCP', () => {
  let tables: ReturnType<typeof baseTables>
  beforeEach(() => { tables = baseTables() })

  it('registra el cobro sin tocar el precio y un reintento no lo duplica', async () => {
    const db = fakeDb(tables)
    const body = { reservation_id: RES, concept: 'Adicional estadía', amount: 500000, due_date: '2027-01-09' }
    const first = await createChargeTool(db, body, ADMIN)
    const retry = await createChargeTool(db, body, ADMIN)
    expect(first).toMatchObject({ ok: true, status: 201, data: { created: true } })
    expect(retry).toMatchObject({ ok: true, status: 200, data: { created: false } })
    expect(tables.reservation_charges).toHaveLength(1)
    expect(tables.reservation_charges[0]).toMatchObject({ created_by: ADMIN.id, updated_via: 'mcp', property_id: 'p1303' })
    expect(tables.reservations[0].amount).toBe(7000000)
  })

  it('si otra llamada gana la carrera, devuelve la suya en vez de fallar', async () => {
    const db = fakeDb(tables, { failInsertOnce: 'reservation_charges' })
    const result = await createChargeTool(db, { reservation_id: RES, concept: 'Adicional estadía', amount: 500000, due_date: '2027-01-09' }, ADMIN)
    expect(result).toMatchObject({ ok: true, data: { created: false, charge: { id: 'winner' } } })
    expect(tables.reservation_charges).toHaveLength(1)
  })

  it('por defecto vence el día de salida y aparece en las salidas de ese día', async () => {
    const db = fakeDb(tables)
    await createChargeTool(db, { reservation_id: RES, concept: 'Adicional estadía', amount: 500000 }, ADMIN)
    expect(tables.reservation_charges[0].due_date).toBe('2027-01-09')
  })

  it('sin usuario identificado no escribe', async () => {
    const result = await createChargeTool(fakeDb(tables), { reservation_id: RES, concept: 'X Y', amount: 1 }, null)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(tables.reservation_charges).toHaveLength(0)
  })

  it('no registra cobros en una reserva cancelada', async () => {
    tables.reservations[0].status = 'cancelled'
    const result = await createChargeTool(fakeDb(tables), { reservation_id: RES, concept: 'Adicional', amount: 5 }, ADMIN)
    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  it('con una versión vieja no pisa el cambio de otro y devuelve el estado actual', async () => {
    const db = fakeDb(tables)
    await createChargeTool(db, { reservation_id: RES, concept: 'Adicional estadía', amount: 500000 }, ADMIN)
    const id = tables.reservation_charges[0].id as string
    const ok = await updateChargeTool(db, { id, expected_version: 1, status: 'collected', confirmation: 'Transferencia SINT-1' }, ADMIN, '2027-01-09')
    expect(ok).toMatchObject({ ok: true, data: { charge: { status: 'collected', collected_on: '2027-01-09', version: 2 } } })
    const stale = await updateChargeTool(db, { id, expected_version: 1, status: 'void', void_reason: 'error' }, ADMIN, '2027-01-09')
    expect(stale).toMatchObject({ ok: false, status: 409, current: { status: 'collected' } })
  })

  it('separa en los totales lo pendiente de lo cobrado', async () => {
    const db = fakeDb(tables)
    await createChargeTool(db, { reservation_id: RES, concept: 'Adicional estadía', amount: 500000 }, ADMIN)
    await createChargeTool(db, { reservation_id: RES, concept: 'Late check-out', amount: 80000, due_date: '2027-01-09' }, ADMIN)
    const id = tables.reservation_charges[1].id as string
    await updateChargeTool(db, { id, expected_version: 1, status: 'collected', confirmation: 'efectivo' }, ADMIN, '2027-01-09')
    const list = await listFollowupsTool(db, { reservation_id: RES }, '2027-01-09')
    expect(list).toMatchObject({ ok: true, data: { totals: { pending_cop: 500000, collected_cop: 80000 } } })
  })
})

describe('solicitudes especiales por el MCP', () => {
  it('cuna: registrada → avisada (sigue sin estar lista) → lista con confirmación', async () => {
    const tables = baseTables()
    const db = fakeDb(tables)
    const created = await createSpecialRequestTool(db, {
      reservation_id: RES_OCT, kind: 'crib', description: 'Coordinar cuna con limpieza', due_date: '2026-10-23', due_time: '07:00', responsible: 'Ana',
    }, ADMIN)
    expect(created).toMatchObject({ ok: true, status: 201, data: { created: true } })
    expect(tables.special_requests[0]).toMatchObject({ status: 'registered', responsible_id: 'm-ana', due_at: '2026-10-23T07:00:00-05:00' })

    const id = tables.special_requests[0].id as string
    const notified = await updateSpecialRequestTool(db, { id, expected_version: 1, status: 'notified', notified_note: 'WhatsApp a Ana' }, ADMIN)
    expect(notified).toMatchObject({ ok: true, data: { request: { status: 'notified' } } })
    expect(tables.special_requests[0].ready_at).toBeUndefined()

    const ready = await updateSpecialRequestTool(db, { id, expected_version: 2, status: 'ready', ready_confirmation: 'Ana: cuna armada y revisada' }, ADMIN)
    expect(ready).toMatchObject({ ok: true, data: { request: { status: 'ready', ready_by: ADMIN.id } } })
  })

  it('no duplica la cuna de la misma reserva', async () => {
    const tables = baseTables()
    const db = fakeDb(tables)
    const body = { reservation_id: RES_OCT, kind: 'crib', description: 'Cuna', due_date: '2026-10-23' }
    await createSpecialRequestTool(db, body, ADMIN)
    expect(await createSpecialRequestTool(db, { ...body, description: 'Cuna otra vez' }, ADMIN))
      .toMatchObject({ ok: true, status: 200, data: { created: false } })
    expect(tables.special_requests).toHaveLength(1)
  })

  it('un responsable que no está en el equipo se rechaza', async () => {
    const result = await createSpecialRequestTool(fakeDb(baseTables()), {
      reservation_id: RES_OCT, kind: 'crib', description: 'Cuna', due_date: '2026-10-23', responsible: 'Pedro',
    }, ADMIN)
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})

describe('salidas y llegadas con cobros y solicitudes', () => {
  it('la salida trae su cobro pendiente y la hora estándar 11:00 aunque la nota diga 12pm', async () => {
    const tables = baseTables()
    const db = fakeDb(tables)
    await createChargeTool(db, { reservation_id: RES, concept: 'Adicional estadía', amount: 500000 }, ADMIN)
    const result = await turnoversTool(db, { date: '2027-01-09' }, '2027-01-01')
    expect(result).toMatchObject({
      ok: true,
      data: { checkouts: [{ property: 'Torres 1303', time: '11:00', time_source: 'default', pending_charges: [{ amount: 500000 }] }] },
    })
  })
})
