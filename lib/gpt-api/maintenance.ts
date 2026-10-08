/**
 * Pendientes de mantenimiento para el API de ChatGPT: listar, crear (sin duplicar) y cambiar
 * estado. Escribe solo status, resolved_at, notes, cost, last_done y next_due; nunca borra.
 */
import { advanceNextDue } from '@/lib/maintenance-schedule'
import type { MaintenancePriority, MaintenanceStatus } from '@/lib/types'
import { shortDate } from './dates'
import type { Db } from './db'
import { normalizeText } from './properties'
import type { MaintenanceFilter, MaintenancePatch } from './validate'

const FIELDS = 'id, title, description, priority, status, notes, cost, created_at, resolved_at, next_due, last_done, interval_months, property:properties(name)'

export interface MaintenanceOut {
  id: string
  property: string | null
  title: string
  description: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  notes: string
  cost: number | null
  created_at: string
  resolved_at: string | null
  next_due: string | null
  last_done: string | null
  interval_months: number | null
}

type Row = Omit<MaintenanceOut, 'property'> & { property: { name: string } | { name: string }[] | null }

function toOut({ property, ...rest }: Row): MaintenanceOut {
  const p = Array.isArray(property) ? property[0] : property
  return { ...rest, property: p?.name ?? null }
}

/** Agrega una línea "[8-oct · ChatGPT] …" al final de las notas, sin borrar lo que había. */
export function appendMaintenanceNote(notes: string | null, note: string, today: string): string {
  const line = `[${shortDate(today)} · ChatGPT] ${note}`
  return notes ? `${notes}\n${line}` : line
}

/** Los pendientes del API salen reportados por Diego, como los de la rutina de reseñas. */
async function diegoId(db: Db): Promise<string> {
  const { data, error } = await db
    .from('team_members').select('id').eq('name', 'Diego').eq('role', 'admin').single()
  if (error || !data) throw new Error(`No encontré a Diego en el equipo: ${error?.message ?? 'sin datos'}`)
  return data.id
}

export async function listMaintenance(
  db: Db,
  opts: { propertyId?: string; status: MaintenanceFilter },
): Promise<MaintenanceOut[]> {
  let query = db.from('maintenance').select(FIELDS).order('created_at', { ascending: false }).limit(100)
  query = opts.status === 'active' ? query.in('status', ['open', 'in_progress']) : query.eq('status', opts.status)
  if (opts.propertyId) query = query.eq('property_id', opts.propertyId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(toOut)
}

export async function createMaintenance(
  db: Db,
  input: { propertyId: string; title: string; description: string; priority: MaintenancePriority; reportedBy?: string },
): Promise<{ created: boolean; issue: MaintenanceOut }> {
  const { data: open, error: openError } = await db
    .from('maintenance').select(FIELDS)
    .eq('property_id', input.propertyId).in('status', ['open', 'in_progress'])
  if (openError) throw new Error(openError.message)
  const same = ((open ?? []) as Row[]).find(r => normalizeText(r.title) === normalizeText(input.title))
  if (same) return { created: false, issue: toOut(same) }

  const { data, error } = await db
    .from('maintenance')
    .insert({
      property_id: input.propertyId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      // The MCP knows who is connected; the GPT's shared key doesn't, so those stay Diego's
      reported_by: input.reportedBy ?? await diegoId(db),
      notes: 'Creado desde ChatGPT.',
    })
    .select(FIELDS)
    .single()
  if (error) throw new Error(error.message)
  return { created: true, issue: toOut(data as Row) }
}

/** null = no existe ese pendiente. */
export async function updateMaintenance(
  db: Db,
  id: string,
  patch: MaintenancePatch,
  today: string,
): Promise<{ issue: MaintenanceOut; scheduled_done: boolean } | null> {
  const { data: current, error: readError } = await db
    .from('maintenance').select('id, notes, interval_months').eq('id', id).maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!current) return null

  const update: Record<string, unknown> = {}
  let scheduledDone = false
  if (patch.status === 'resolved' && current.interval_months > 0) {
    // Recurring preventive: same as the app's "Hecho" button — it stays open and comes back
    // on its next date instead of disappearing.
    update.last_done = today
    update.next_due = advanceNextDue(today, current.interval_months)
    scheduledDone = true
  } else if (patch.status) {
    update.status = patch.status
    update.resolved_at = patch.status === 'resolved' ? new Date().toISOString() : null
  }
  if (patch.note) update.notes = appendMaintenanceNote(current.notes, patch.note, today)
  if (patch.cost !== undefined) update.cost = patch.cost

  const { data, error } = await db.from('maintenance').update(update).eq('id', id).select(FIELDS).single()
  if (error) throw new Error(error.message)
  return { issue: toOut(data as Row), scheduled_done: scheduledDone }
}
