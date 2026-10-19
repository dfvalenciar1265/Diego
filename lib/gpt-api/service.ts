/**
 * Lo que hace cada herramienta del API del GPT y del MCP, sin HTTP: valida, consulta o escribe,
 * y refresca las pantallas afectadas. Las rutas /api/gpt/* y /api/mcp solo traducen el resultado.
 */
import { revalidatePath } from 'next/cache'
import { guestNameMatches } from '@/lib/gmail-sync'
import { compareReservations } from './compare'
import { shortDate } from './dates'
import type { Db } from './db'
import {
  chargesFor, createCharge, pendingChargesDue, createRequest, findCharge, findRequest, parseChargePatch, parseNewCharge,
  parseNewRequest, parseRequestPatch, requestsFor, updateCharge, updateRequest, type Actor,
} from './followups'
import { createMaintenance, listMaintenance, updateMaintenance } from './maintenance'
import { listProperties, resolveProperty } from './properties'
import {
  appendReservationNote, cancelReservationRow, conflictMessage, creationNotes, findReservationByCode,
  findReservationById, insertReservation, reservationConflicts, toReservationOut, updateReservationRow,
  type ReservationRow,
} from './reservation-writes'
import { applyDiffNotes, listReservations, loadForCompare } from './reservations'
import {
  checkinSlot, checkoutSlot, reservationsTurningOver, setTaskNotes, withCheckinTime, withCheckoutTime,
} from './turnovers'
import {
  isUuid, parseCompareBody, parseMaintenanceFilter, parseMaintenancePatch, parseNewMaintenance, parseRange,
  parseTimeChange, parseTurnoverDate, checkStay, parseNewReservation, parseReservationId, parseReservationPatch,
} from './validate'

export type ServiceResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; current?: unknown }

const done = <T>(data: T, status = 200): ServiceResult<T> => ({ ok: true, status, data })
const failed = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error })
const unknownProperty = (name: string) =>
  failed(404, `No reconozco el apartamento «${name}». Consulta listProperties para ver los nombres.`)

function refreshMaintenance() {
  revalidatePath('/maintenance')
  revalidatePath('/')
}

export async function propertiesTool(db: Db) {
  return done({ properties: await listProperties(db, { onlyActive: true }) })
}

export async function listMaintenanceTool(db: Db, query: { property?: string | null; status?: string | null }) {
  const status = parseMaintenanceFilter(query.status ?? null)
  if (!status.ok) return failed(400, status.error)
  let propertyId: string | undefined
  if (query.property) {
    const property = resolveProperty(query.property, await listProperties(db))
    if (!property) return unknownProperty(query.property)
    propertyId = property.id
  }
  const issues = await listMaintenance(db, { propertyId, status: status.value })
  return done({ count: issues.length, issues })
}

export async function createMaintenanceTool(db: Db, body: unknown, reportedBy?: string) {
  const input = parseNewMaintenance(body)
  if (!input.ok) return failed(400, input.error)
  const property = resolveProperty(input.value.property, await listProperties(db))
  if (!property) return unknownProperty(input.value.property)

  const result = await createMaintenance(db, {
    propertyId: property.id,
    title: input.value.title,
    description: input.value.description,
    priority: input.value.priority,
    reportedBy,
  })
  if (result.created) refreshMaintenance()
  return done(result, result.created ? 201 : 200)
}

export async function updateMaintenanceTool(db: Db, id: string, body: unknown, today: string) {
  if (!isUuid(id)) return failed(404, 'No existe ese pendiente.')
  const patch = parseMaintenancePatch(body)
  if (!patch.ok) return failed(400, patch.error)
  const result = await updateMaintenance(db, id, patch.value, today)
  if (!result) return failed(404, 'No existe ese pendiente.')
  refreshMaintenance()
  return done(result)
}

/**
 * `includeAmount` is only for the MCP connector (OAuth, active admins). The
 * ChatGPT Actions API authenticates with a shared key and is documented as
 * «sin montos», so it never gets them.
 */
export async function listReservationsTool(
  db: Db,
  query: { from?: string | null; to?: string | null; property?: string | null },
  today: string,
  { includeAmount = false }: { includeAmount?: boolean } = {},
) {
  const range = parseRange(query.from ?? null, query.to ?? null, today)
  if (!range.ok) return failed(400, range.error)

  const properties = await listProperties(db)
  let propertyId: string | undefined
  if (query.property) {
    const property = resolveProperty(query.property, properties)
    if (!property) return unknownProperty(query.property)
    propertyId = property.id
  }

  const rows = await listReservations(db, range.value, propertyId)
  const nameOf = new Map(properties.map(p => [p.id, p.name]))
  return done({
    ...range.value,
    count: rows.length,
    reservations: rows.map(r => ({
      id: r.id,
      airbnb_code: r.airbnb_code,
      guest_name: r.guest_name,
      property: nameOf.get(r.property_id) ?? null,
      check_in: r.check_in,
      check_out: r.check_out,
      guests: r.guests,
      ...(includeAmount ? { amount: Number(r.amount ?? 0) } : {}),
      status: r.status,
      source: r.source,
      notes: r.notes,
    })),
  })
}

export async function compareReservationsTool(db: Db, body: unknown, today: string) {
  const input = parseCompareBody(body)
  if (!input.ok) return failed(400, input.error)
  const { from, to, dry_run, reservations } = input.value

  const properties = await listProperties(db)
  const codes = reservations.flatMap(r => (r.code ? [r.code] : []))
  const rows = await loadForCompare(db, { from, to }, codes)
  const result = compareReservations(input.value, rows, properties)

  let noted = new Set<string>()
  let cleared = 0
  if (!dry_run) {
    ;({ noted, cleared } = await applyDiffNotes(db, rows, result, today))
    if (noted.size > 0 || cleared > 0) revalidatePath('/', 'layout')
  }

  return done({
    from,
    to,
    dry_run,
    summary: result.summary,
    differences: result.differences.map(d => ({
      ...d,
      noted: d.reservation_id ? noted.has(d.reservation_id) : false,
    })),
    unmatched: result.unmatched,
    notes_cleared: cleared,
  })
}

function refreshTurnovers() {
  revalidatePath('/')
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
}

/** Salidas y llegadas de un día con su hora actual (por defecto hoy). */
export async function turnoversTool(db: Db, query: { date?: string | null }, today: string) {
  const date = parseTurnoverDate(query.date, today)
  if (!date.ok) return failed(400, date.error)
  const properties = await listProperties(db)
  const nameOf = (id: string) => properties.find(p => p.id === id)?.name ?? '—'
  const [checkouts, checkins, dueToday] = await Promise.all([
    reservationsTurningOver(db, 'checkout', date.value),
    reservationsTurningOver(db, 'checkin', date.value),
    pendingChargesDue(db, date.value),
  ])
  const [charges, requests] = await Promise.all([
    chargesFor(db, checkouts.map(r => r.id)),
    requestsFor(db, checkins.map(r => r.id)),
  ])
  const pending = [...charges.filter(c => c.status === 'pending'), ...dueToday]
    .filter((c, i, all) => all.findIndex(x => x.id === c.id) === i)
    .map(c => ({ ...c, amount: Number(c.amount) }))
  const checkoutIds = new Set(checkouts.map(r => r.id))
  return done({
    date: date.value,
    checkouts: checkouts.map(r => ({
      ...checkoutSlot(r, date.value, nameOf(r.property_id)),
      pending_charges: pending.filter(c => c.reservation_id === r.id),
    })),
    // Cobros que vencen ese día de reservas que no salen ese día (no se pierden de vista).
    other_charges_due: pending.filter(c => !checkoutIds.has(c.reservation_id))
      .map(c => ({ ...c, property: nameOf(c.property_id) })),
    checkins: checkins.map(r => ({
      ...checkinSlot(r, nameOf(r.property_id)),
      special_requests: requests.filter(q => q.reservation_id === r.id && q.status !== 'cancelled'),
    })),
  })
}

/**
 * Cambia la hora de salida (tarea de limpieza) o de llegada (tarea de preparación) de la reserva
 * que sale o llega ese día en el apartamento, igual que los lápices de la portada.
 */
async function changeTurnoverTime(db: Db, kind: 'checkout' | 'checkin', body: unknown, today: string) {
  const input = parseTimeChange(body, today)
  if (!input.ok) return failed(400, input.error)
  const property = resolveProperty(input.value.property, await listProperties(db))
  if (!property) return unknownProperty(input.value.property)
  const { date, time, guest_name: guest } = input.value
  const word = kind === 'checkout' ? 'salida' : 'llegada'

  let matches = await reservationsTurningOver(db, kind, date, property.id)
  if (guest) matches = matches.filter(r => guestNameMatches(r.guest_name, guest) || guestNameMatches(guest, r.guest_name))
  if (matches.length === 0) {
    return failed(404, `${property.name} no tiene ${word}${guest ? ` de ${guest}` : ''} el ${shortDate(date)}.`)
  }
  if (matches.length > 1) {
    return failed(409, `${property.name} tiene ${matches.length} ${word}s el ${shortDate(date)} (${matches.map(r => r.guest_name).join(', ')}). Indica el huésped en guest_name.`)
  }
  const reservation = matches[0]

  if (kind === 'checkout') {
    const slot = checkoutSlot(reservation, date, property.name)
    if (!slot.cleaning_task_id) {
      return failed(409, `La salida de ${slot.guest_name} en ${property.name} no tiene tarea de limpieza el ${shortDate(date)}; corre la sincronización de Gmail para repararla.`)
    }
    await setTaskNotes(db, slot.cleaning_task_id, withCheckoutTime(time))
    refreshTurnovers()
    return done({ date, ...slot, previous_time: slot.time, time, time_source: 'app' })
  }

  const slot = checkinSlot(reservation, property.name)
  if (!slot.preparation_task_id) {
    return failed(409, `La llegada de ${slot.guest_name} a ${property.name} no tiene tarea de preparación; corre la sincronización de Gmail para repararla.`)
  }
  const task = reservation.tasks?.find(t => t.id === slot.preparation_task_id)
  await setTaskNotes(db, slot.preparation_task_id, withCheckinTime(task?.notes ?? null, time))
  refreshTurnovers()
  return done({ date, ...slot, previous_time: slot.time, time, time_source: 'app' })
}

export const setCheckoutTimeTool = (db: Db, body: unknown, today: string) =>
  changeTurnoverTime(db, 'checkout', body, today)

export const setCheckinTimeTool = (db: Db, body: unknown, today: string) =>
  changeTurnoverTime(db, 'checkin', body, today)

function refreshReservations() {
  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
}

const STATUS_ES: Record<string, string> = { confirmed: 'confirmada', blocked: 'bloqueo', cancelled: 'cancelada' }
const stayText = (r: { check_in: string; check_out: string }) => `${shortDate(r.check_in)} a ${shortDate(r.check_out)}`

/** Crea una reserva (directa o de Airbnb) con sus tareas; nunca duplica un código ni se cruza con otra. */
export async function createReservationTool(db: Db, body: unknown, today: string, createdBy = 'ChatGPT') {
  const input = parseNewReservation(body)
  if (!input.ok) return failed(400, input.error)
  const v = input.value
  const property = resolveProperty(v.property, await listProperties(db))
  if (!property) return unknownProperty(v.property)

  if (v.code) {
    const existing = await findReservationByCode(db, v.code)
    if (existing) {
      return failed(409, `Ya existe la reserva ${v.code} de ${existing.guest_name} (${stayText(existing)}, ${STATUS_ES[existing.status] ?? existing.status}); no creo otra. Para cambiarla usa update_reservation con id ${existing.id}.`)
    }
  }
  const conflicts = await reservationConflicts(db, property.id, v)
  if (conflicts.length > 0) return failed(409, conflictMessage(property.name, conflicts))

  const { reservation, tasks_created } = await insertReservation(db, {
    property_id: property.id,
    source: v.source,
    airbnb_code: v.code,
    guest_name: v.guest_name,
    check_in: v.check_in,
    check_out: v.check_out,
    guests: v.guests,
    amount: v.amount,
    notes: creationNotes(createdBy, today, v.note),
    status: 'confirmed',
  }, today)
  refreshReservations()
  return done({ reservation: toReservationOut(reservation, property.name), tasks_created }, 201)
}

/** Cambia huésped, huéspedes, fechas o monto, o agrega una nota; mueve las tareas si cambian las fechas. */
export async function updateReservationTool(db: Db, body: unknown, today: string) {
  const parsed = parseReservationPatch(body)
  if (!parsed.ok) return failed(400, parsed.error)
  const patch = parsed.value
  const current = await findReservationById(db, patch.id)
  if (!current) return failed(404, 'No existe esa reserva.')
  if (current.status === 'cancelled') {
    return failed(409, 'Esa reserva está cancelada; si hace falta, créala de nuevo con create_reservation.')
  }

  const stay = checkStay(patch.check_in ?? current.check_in, patch.check_out ?? current.check_out)
  if (!stay.ok) return failed(400, stay.error)
  const datesChanged = stay.value.check_in !== current.check_in || stay.value.check_out !== current.check_out
  const propertyName = (await listProperties(db)).find(p => p.id === current.property_id)?.name ?? '—'
  if (datesChanged) {
    const conflicts = await reservationConflicts(db, current.property_id, stay.value, current.id)
    if (conflicts.length > 0) return failed(409, conflictMessage(propertyName, conflicts))
  }

  const update: Partial<Omit<ReservationRow, 'id'>> = { ...stay.value }
  if (patch.guest_name !== undefined) update.guest_name = patch.guest_name
  if (patch.guests !== undefined) update.guests = patch.guests
  if (patch.amount !== undefined) update.amount = patch.amount
  if (patch.note) update.notes = appendReservationNote(current.notes, patch.note)

  const result = await updateReservationRow(db, current.id, update, datesChanged, today)
  refreshReservations()
  return done({
    reservation: toReservationOut(result.reservation, propertyName),
    previous: {
      guest_name: current.guest_name,
      check_in: current.check_in,
      check_out: current.check_out,
      guests: current.guests,
      amount: Number(current.amount ?? 0),
    },
    tasks_moved: result.tasks_moved,
    tasks_created: result.tasks_created,
  })
}

/** "Borrar" como la app: la reserva queda cancelada y se borran sus tareas. */
export async function cancelReservationTool(db: Db, body: unknown) {
  const id = parseReservationId(body)
  if (!id.ok) return failed(400, id.error)
  const current = await findReservationById(db, id.value)
  if (!current) return failed(404, 'No existe esa reserva.')
  const propertyName = (await listProperties(db)).find(p => p.id === current.property_id)?.name ?? '—'
  if (current.status === 'cancelled') {
    return done({ already_cancelled: true, reservation: toReservationOut(current, propertyName), tasks_deleted: 0 })
  }
  const { reservation, tasks_deleted } = await cancelReservationRow(db, current.id)
  refreshReservations()
  return done({ already_cancelled: false, reservation: toReservationOut(reservation, propertyName), tasks_deleted })
}

// ── Cobros adicionales y solicitudes especiales ──────────────────────────────

const noActor = () => failed(403, 'No sé quién está conectado: vuelve a autorizar el conector.')
const conflict = (what: string, current: unknown) => ({
  ok: false as const, status: 409,
  error: `${what} cambió desde que lo leíste (otra persona o una llamada anterior). No se aplicó nada; revisa el estado actual y vuelve a intentarlo con su version.`,
  current,
})

function refreshFollowups() {
  revalidatePath('/')
  revalidatePath('/cleaning')
}

async function memberIdByName(db: Db, name: string): Promise<string | null> {
  const { data, error } = await db.from('team_members').select('id, name').eq('active', true)
  if (error) throw new Error(error.message)
  const hit = (data ?? []).find(m => guestNameMatches(m.name, name) || guestNameMatches(name, m.name))
  return hit?.id ?? null
}

/**
 * Cobros y solicitudes de una reserva o de las reservas con noches en un rango. Los totales
 * separan lo pendiente de lo cobrado: un cobro pendiente no es ingreso recibido.
 */
export async function listFollowupsTool(
  db: Db,
  query: { reservation_id?: string | null; from?: string | null; to?: string | null; property?: string | null },
  today: string,
) {
  const properties = await listProperties(db)
  const nameOf = (id: string) => properties.find(p => p.id === id)?.name ?? '—'
  let reservations: { id: string; property_id: string; guest_name: string; check_in: string; check_out: string; status: string; airbnb_code: string | null }[]
  if (query.reservation_id) {
    if (!isUuid(query.reservation_id)) return failed(400, '"reservation_id" debe ser el id de la reserva (de list_reservations).')
    const r = await findReservationById(db, query.reservation_id)
    if (!r) return failed(404, 'No existe esa reserva.')
    reservations = [r]
  } else {
    const range = parseRange(query.from ?? null, query.to ?? null, today)
    if (!range.ok) return failed(400, range.error)
    let propertyId: string | undefined
    if (query.property) {
      const property = resolveProperty(query.property, properties)
      if (!property) return unknownProperty(query.property)
      propertyId = property.id
    }
    reservations = await listReservations(db, range.value, propertyId)
  }
  const ids = reservations.map(r => r.id)
  const [charges, requests] = await Promise.all([chargesFor(db, ids), requestsFor(db, ids)])
  const sum = (status: string) => charges.filter(c => c.status === status).reduce((s, c) => s + Number(c.amount), 0)
  return done({
    totals: { pending_cop: sum('pending'), collected_cop: sum('collected') },
    needs_review: charges.filter(c => c.review_reason).length + requests.filter(q => q.review_reason).length,
    reservations: reservations
      .filter(r => query.reservation_id || charges.some(c => c.reservation_id === r.id) || requests.some(q => q.reservation_id === r.id))
      .map(r => ({
        id: r.id,
        airbnb_code: r.airbnb_code,
        guest_name: r.guest_name,
        property: nameOf(r.property_id),
        check_in: r.check_in,
        check_out: r.check_out,
        status: r.status,
        charges: charges.filter(c => c.reservation_id === r.id).map(c => ({ ...c, amount: Number(c.amount) })),
        special_requests: requests.filter(q => q.reservation_id === r.id),
      })),
  })
}

/** Registra un cobro adicional (aparte del precio de la reserva); repetir la llamada no duplica. */
export async function createChargeTool(db: Db, body: unknown, actor: Actor | null) {
  if (!actor) return noActor()
  const input = parseNewCharge(body)
  if (!input.ok) return failed(400, input.error)
  const reservation = await findReservationById(db, input.value.reservation_id)
  if (!reservation) return failed(404, 'No existe esa reserva.')
  if (reservation.status === 'cancelled') return failed(409, 'Esa reserva está cancelada; no le registro cobros.')
  const result = await createCharge(db, {
    ...input.value,
    due_date: input.value.due_date ?? reservation.check_out,
    property_id: reservation.property_id,
  }, actor)
  if (result.created) refreshFollowups()
  return done({ ...result, charge: { ...result.charge, amount: Number(result.charge.amount) } }, result.created ? 201 : 200)
}

export async function updateChargeTool(db: Db, body: unknown, actor: Actor | null, today: string) {
  if (!actor) return noActor()
  const patch = parseChargePatch(body, today)
  if (!patch.ok) return failed(400, patch.error)
  const current = await findCharge(db, patch.value.id)
  if (!current) return failed(404, 'No existe ese cobro.')
  if (current.version !== patch.value.expected_version) return conflict('El cobro', current)
  const result = await updateCharge(db, patch.value, current, actor, today)
  if (result.kind === 'not_found') return failed(404, 'No existe ese cobro.')
  if (result.kind === 'conflict') return conflict('El cobro', result.current)
  if (result.kind === 'rejected') return failed(409, result.message)
  refreshFollowups()
  return done({ previous: current, charge: { ...result.row, amount: Number(result.row.amount) } })
}

/** Registra una solicitud especial (cuna, camas…) de una reserva; repetir la llamada no duplica. */
export async function createSpecialRequestTool(db: Db, body: unknown, actor: Actor | null) {
  if (!actor) return noActor()
  const input = parseNewRequest(body)
  if (!input.ok) return failed(400, input.error)
  const reservation = await findReservationById(db, input.value.reservation_id)
  if (!reservation) return failed(404, 'No existe esa reserva.')
  if (reservation.status === 'cancelled') return failed(409, 'Esa reserva está cancelada; no le registro solicitudes.')
  let responsibleId: string | null = null
  if (input.value.responsible) {
    responsibleId = await memberIdByName(db, input.value.responsible)
    if (!responsibleId) return failed(404, `No encuentro a «${input.value.responsible}» en el equipo activo.`)
  }
  const { reservation_id, kind, description, due_at } = input.value
  const result = await createRequest(db, { reservation_id, kind, description, due_at, responsible_id: responsibleId, property_id: reservation.property_id }, actor)
  if (result.created) refreshFollowups()
  return done(result, result.created ? 201 : 200)
}

export async function updateSpecialRequestTool(db: Db, body: unknown, actor: Actor | null) {
  if (!actor) return noActor()
  const patch = parseRequestPatch(body)
  if (!patch.ok) return failed(400, patch.error)
  const current = await findRequest(db, patch.value.id)
  if (!current) return failed(404, 'No existe esa solicitud.')
  if (current.version !== patch.value.expected_version) return conflict('La solicitud', current)
  let responsibleId: string | undefined
  if (patch.value.responsible) {
    responsibleId = (await memberIdByName(db, patch.value.responsible)) ?? undefined
    if (!responsibleId) return failed(404, `No encuentro a «${patch.value.responsible}» en el equipo activo.`)
  }
  const result = await updateRequest(db, { ...patch.value, responsible_id: responsibleId }, actor)
  if (result.kind === 'not_found') return failed(404, 'No existe esa solicitud.')
  if (result.kind === 'conflict') return conflict('La solicitud', result.current)
  if (result.kind === 'rejected') return failed(409, result.message)
  refreshFollowups()
  return done({ previous: current, request: result.row })
}
