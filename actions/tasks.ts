'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { Task, TaskStatus } from '@/lib/types'

/**
 * Returns cleaning tasks: pending/in-progress from today forward + done
 * tasks from the last 30 days (for the Terminadas tab).
 */
export async function getCleaningTasks(): Promise<(Task & {
  property?: { name: string }
  assignee?: { name: string }
  reservation?: { check_in: string; check_out: string; notes: string | null; guest_name: string | null } | null
})[]> {
  const supabase = await createClient()
  const today   = new Date().toISOString().slice(0, 10)
  const ago30   = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  // Active tasks: today and forward
  const activeQ = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name), reservation:reservations(check_in, check_out, notes, guest_name)')
    .eq('type', 'cleaning')
    .gte('scheduled_for', today)
    .neq('status', 'done')
    .order('scheduled_for', { ascending: true })

  // Done tasks: last 30 days
  const doneQ = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name), reservation:reservations(check_in, check_out, notes, guest_name)')
    .eq('type', 'cleaning')
    .eq('status', 'done')
    .gte('scheduled_for', ago30)
    .order('completed_at', { ascending: false })

  const [activeRes, doneRes] = await Promise.all([activeQ, doneQ])
  if (activeRes.error) throw new Error(activeRes.error.message)
  if (doneRes.error)   throw new Error(doneRes.error.message)
  return [...(activeRes.data ?? []), ...(doneRes.data ?? [])]
}

/** Assigns a task to a team member (or unassigns if memberId is null). */
export async function assignTask(
  taskId: string,
  memberId: string | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ assigned_to: memberId })
    .eq('id', taskId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
  return { success: true }
}

export async function getTasks(filters?: {
  date?: string
  assignedTo?: string
  propertyId?: string
}): Promise<Task[]> {
  const supabase = await createClient()
  let query = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name), reservation:reservations(check_in, check_out, notes, guest_name)')
    .order('scheduled_for', { ascending: true })

  if (filters?.date) query = query.eq('scheduled_for', filters.date)
  if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
  if (filters?.propertyId) query = query.eq('property_id', filters.propertyId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Assigns a cleaner and sets status to in_progress in one round-trip. */
export async function assignAndStartTask(
  taskId: string,
  memberId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ assigned_to: memberId, status: 'in_progress' })
    .eq('id', taskId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

/** Updates the notes field of a task (used for check-in time annotation). */
export async function updateTaskNotes(
  taskId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ notes })
    .eq('id', taskId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/')
  revalidatePath('/tasks')
  return { success: true }
}

export async function createTask(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const costRaw = formData.get('cost') as string
  const { error } = await supabase.from('tasks').insert({
    property_id:    formData.get('property_id') as string,
    reservation_id: (formData.get('reservation_id') as string) || null,
    type:           formData.get('type') as string,
    assigned_to:    (formData.get('assigned_to') as string) || null,
    scheduled_for:  formData.get('scheduled_for') as string,
    notes:          (formData.get('notes') as string) || '',
    cost:           costRaw ? parseFloat(costRaw) : null,
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
  const { error } = await supabase.from('tasks').update({
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/tasks')
  revalidatePath('/')
}

/** Completes a task and optionally records cost, notes, and assignee. */
export async function completeTask(
  taskId: string,
  options: { cost?: number | null; notes?: string; assignedTo?: string | null }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const update: Record<string, unknown> = {
    status:       'done',
    completed_at: new Date().toISOString(),
  }
  if (options.notes    !== undefined) update.notes       = options.notes
  if (options.assignedTo !== undefined) update.assigned_to = options.assignedTo
  if (options.cost     !== undefined) update.cost        = options.cost

  const { error } = await supabase.from('tasks').update(update).eq('id', taskId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

/**
 * Marks all pending/in-progress tasks whose scheduled date is strictly before
 * today as "done". Called automatically during each Gmail sync run so the task
 * list stays clean — past cleaning/preparation tasks no longer show as pending.
 *
 * Uses the service-role client so it can run from a cron route (no session).
 * Returns the number of tasks that were updated.
 */
export async function completeOverdueTasks(): Promise<number> {
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const { data, error } = await db
    .from('tasks')
    .update({
      status:       'done',
      completed_at: new Date().toISOString(),
    })
    .lt('scheduled_for', today)        // strictly before today
    .in('status', ['pending', 'in_progress'])
    .select('id')

  if (error) {
    console.error('[completeOverdueTasks]', error.message)
    return 0
  }

  if ((data?.length ?? 0) > 0) {
    revalidatePath('/tasks')
    revalidatePath('/')
  }

  return data?.length ?? 0
}
