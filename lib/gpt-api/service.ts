/**
 * Lo que hace cada herramienta del API del GPT y del MCP, sin HTTP: valida, consulta o escribe,
 * y refresca las pantallas afectadas. Las rutas /api/gpt/* y /api/mcp solo traducen el resultado.
 */
import { revalidatePath } from 'next/cache'
import { guestNameMatches } from '@/lib/gmail-sync'
import { compareReservations } from './compare'
import { shortDate } from './dates'
import type { Db } from './db'
import { createMaintenance, listMaintenance, updateMaintenance } from './maintenance'
import { listProperties, resolveProperty } from './properties'
import { applyDiffNotes, listReservations, loadForCompare } from './reservations'
import {
  checkinSlot, checkoutSlot, reservationsTurningOver, setTaskNotes, withCheckinTime, withCheckoutTime,
} from './turnovers'
import {
  isUuid, parseCompareBody, parseMaintenanceFilter, parseMaintenancePatch, parseNewMaintenance, parseRange,
  parseTimeChange, parseTurnoverDate,
} from './validate'

export type ServiceResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string }

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

export async function listReservationsTool(
  db: Db,
  query: { from?: string | null; to?: string | null; property?: string | null },
  today: string,
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
      airbnb_code: r.airbnb_code,
      guest_name: r.guest_name,
      property: nameOf.get(r.property_id) ?? null,
      check_in: r.check_in,
      check_out: r.check_out,
      guests: r.guests,
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
  const [checkouts, checkins] = await Promise.all([
    reservationsTurningOver(db, 'checkout', date.value),
    reservationsTurningOver(db, 'checkin', date.value),
  ])
  return done({
    date: date.value,
    checkouts: checkouts.map(r => checkoutSlot(r, date.value, nameOf(r.property_id))),
    checkins: checkins.map(r => checkinSlot(r, nameOf(r.property_id))),
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
