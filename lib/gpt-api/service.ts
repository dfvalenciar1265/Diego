/**
 * Lo que hace cada herramienta del API del GPT y del MCP, sin HTTP: valida, consulta o escribe,
 * y refresca las pantallas afectadas. Las rutas /api/gpt/* y /api/mcp solo traducen el resultado.
 */
import { revalidatePath } from 'next/cache'
import { compareReservations } from './compare'
import type { Db } from './db'
import { createMaintenance, listMaintenance, updateMaintenance } from './maintenance'
import { listProperties, resolveProperty } from './properties'
import { applyDiffNotes, listReservations, loadForCompare } from './reservations'
import {
  isUuid, parseCompareBody, parseMaintenanceFilter, parseMaintenancePatch, parseNewMaintenance, parseRange,
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
