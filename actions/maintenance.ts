'use server'
import { todayInBogota, isIsoDate } from '@/lib/gpt-api/dates'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { MaintenanceIssue, MaintenanceStatus } from '@/lib/types'
import { advanceNextDue } from '@/lib/maintenance-schedule'
import { canDo } from '@/lib/permissions'
import type { UserRole } from '@/lib/types'

/** Status changes, rescheduling and «Deshacer» are for maintenance managers only
 *  (the UI hides them behind maintenance:manage; RLS doesn't enforce it). */
async function requireManager(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ success: false; error: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }
  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  if (!member || !canDo(member.role as UserRole, 'maintenance:manage')) {
    return { success: false, error: 'No tienes permiso para gestionar mantenimiento' }
  }
  return null
}

export async function getMaintenance(filters?: {
  status?: MaintenanceStatus
  propertyId?: string
}): Promise<MaintenanceIssue[]> {
  const supabase = await createClient()
  let query = supabase
    .from('maintenance')
    .select('*, property:properties(name), reporter:team_members!reported_by(name), assignee:team_members!assigned_to(name)')
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.propertyId) query = query.eq('property_id', filters.propertyId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

const PRIORITIES = ['urgent', 'normal', 'scheduled'] as const
/** «Repetir cada» options offered by the form; empty = no repetition. */
const INTERVALS = [1, 2, 3, 6, 12]

export async function createMaintenanceIssue(
  formData: FormData,
  photoUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  // Anyone signed in can report (maintenance:report is every role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const str = (k: string) => String(formData.get(k) ?? '').trim()
  const propertyId = str('property_id')
  const title      = str('title')
  const priority   = str('priority') || 'normal'
  if (!propertyId) return { success: false, error: 'Elige el apartamento.' }
  if (!title)      return { success: false, error: 'Escribe un título.' }
  if (!(PRIORITIES as readonly string[]).includes(priority)) {
    return { success: false, error: 'Prioridad no válida.' }
  }

  // Preventive maintenance: next date (defaults to today in Colombia) + optional repetition
  let schedule: { next_due: string; interval_months: number | null } | null = null
  if (priority === 'scheduled') {
    const nextDue = str('next_due') || todayInBogota()
    if (!isIsoDate(nextDue)) return { success: false, error: 'La próxima fecha no es válida.' }
    const rawInterval = str('interval_months')
    const interval = rawInterval ? Number(rawInterval) : null
    if (interval !== null && !INTERVALS.includes(interval)) {
      return { success: false, error: 'Elige cada cuántos meses se repite (1, 2, 3, 6 o 12) o «Sin repetir».' }
    }
    schedule = { next_due: nextDue, interval_months: interval }
  }

  const { error } = await supabase.from('maintenance').insert({
    property_id: propertyId,
    title,
    description: str('description'),
    photo_url: photoUrl ?? null,
    priority,
    reported_by: user.id,
    ...(schedule ?? {}),
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

export async function updateMaintenanceStatus(
  id: string,
  status: MaintenanceStatus,
  options?: {
    notes?: string; assignedTo?: string | null; cost?: number | null
    /** Only apply if the row is still in this status («Deshacer» must not clobber newer changes). */
    expectStatus?: MaintenanceStatus
  }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const denied = await requireManager(supabase)
  if (denied) return denied
  const update: Record<string, unknown> = {
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
  }
  if (options?.notes      !== undefined) update.notes       = options.notes
  if (options?.assignedTo !== undefined) update.assigned_to = options.assignedTo
  if (options?.cost       !== undefined) update.cost        = options.cost

  let query = supabase.from('maintenance').update(update).eq('id', id)
  if (options?.expectStatus) query = query.eq('status', options.expectStatus)
  const { data, error } = await query.select('id')
  if (error) return { success: false, error: error.message }
  if (options?.expectStatus && (data?.length ?? 0) === 0) {
    return { success: false, error: 'La incidencia ya cambió; no se deshizo.' }
  }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

/** Reprograma un mantenimiento programado: cambia su próxima fecha (YYYY-MM-DD). */
export async function rescheduleMaintenance(
  id: string,
  nextDue: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const denied = await requireManager(supabase)
  if (denied) return denied

  const { error } = await supabase
    .from('maintenance')
    .update({ next_due: nextDue || null })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

/**
 * Marca hecho un preventivo recurrente: registra la fecha de hoy como "última"
 * y AVANZA la próxima según el intervalo (hoy + N meses), sin resolverlo, para
 * que el recurrente reaparezca en su próxima fecha. Si no tiene intervalo, la
 * próxima queda vacía para reprogramarla a mano.
 */
export async function completeScheduledMaintenance(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const denied = await requireManager(supabase)
  if (denied) return denied

  const { data: issue } = await supabase
    .from('maintenance')
    .select('interval_months')
    .eq('id', id)
    .single()

  const todayStr = todayInBogota()
  const nextDue = advanceNextDue(todayStr, issue?.interval_months)

  const { error } = await supabase
    .from('maintenance')
    .update({ last_done: todayStr, next_due: nextDue })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

/**
 * «Deshacer» de "Marcar como hecho": devuelve las fechas de un preventivo a como
 * estaban antes (última y próxima). Solo toca esas dos columnas.
 */
export async function restoreScheduledDates(
  id: string,
  lastDone: string | null,
  nextDue: string | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const denied = await requireManager(supabase)
  if (denied) return denied
  if ((lastDone && !isIsoDate(lastDone)) || (nextDue && !isIsoDate(nextDue))) {
    return { success: false, error: 'Fecha no válida.' }
  }

  const { error } = await supabase
    .from('maintenance')
    .update({ last_done: lastDone, next_due: nextDue })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}
