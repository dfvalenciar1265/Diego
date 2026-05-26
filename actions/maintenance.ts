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
  notes?: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('maintenance').update({
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    notes: notes ?? '',
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/maintenance')
  revalidatePath('/')
}

