'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Task, TaskStatus } from '@/lib/types'

export async function getTasks(filters?: {
  date?: string
  assignedTo?: string
  propertyId?: string
}): Promise<Task[]> {
  const supabase = await createClient()
  let query = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name)')
    .order('scheduled_for', { ascending: true })

  if (filters?.date) query = query.eq('scheduled_for', filters.date)
  if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
  if (filters?.propertyId) query = query.eq('property_id', filters.propertyId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createTask(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').insert({
    property_id: formData.get('property_id') as string,
    reservation_id: (formData.get('reservation_id') as string) || null,
    type: formData.get('type') as string,
    assigned_to: (formData.get('assigned_to') as string) || null,
    scheduled_for: formData.get('scheduled_for') as string,
    notes: (formData.get('notes') as string) || '',
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('tasks').update({
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  }).eq('id', id)
  revalidatePath('/tasks')
  revalidatePath('/')
}
