'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { MaintenanceIssue, MaintenanceStatus } from '@/lib/types'

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

export async function createMaintenanceIssue(
  formData: FormData,
  photoUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { error } = await supabase.from('maintenance').insert({
    property_id: formData.get('property_id') as string,
    title: formData.get('title') as string,
    description: (formData.get('description') as string) || '',
    photo_url: photoUrl ?? null,
    priority: (formData.get('priority') as string) || 'normal',
    reported_by: user.id,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

export async function updateMaintenanceStatus(
  id: string,
  status: MaintenanceStatus,
  options?: { notes?: string; assignedTo?: string | null; cost?: number | null }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const update: Record<string, unknown> = {
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
  }
  if (options?.notes      !== undefined) update.notes       = options.notes
  if (options?.assignedTo !== undefined) update.assigned_to = options.assignedTo
  if (options?.cost       !== undefined) update.cost        = options.cost

  const { error } = await supabase.from('maintenance').update(update).eq('id', id)
  if (error) return { success: false, error: error.message }
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: issue } = await supabase
    .from('maintenance')
    .select('interval_months')
    .eq('id', id)
    .single()

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  let nextDue: string | null = null
  const interval = issue?.interval_months
  if (interval && interval > 0) {
    const d = new Date(today)
    d.setMonth(d.getMonth() + interval)
    nextDue = d.toISOString().slice(0, 10)
  }

  const { error } = await supabase
    .from('maintenance')
    .update({ last_done: todayStr, next_due: nextDue })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

