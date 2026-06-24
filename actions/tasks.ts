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
  reservation?: { check_in: string; check_out: string; notes: string | null; guest_name: string | null; guests: number | null } | null
})[]> {
  const supabase = await createClient()
  const today   = new Date().toISOString().slice(0, 10)
  const ago30   = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  // Active tasks: today and forward
  const activeQ = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name), reservation:reservations(check_in, check_out, notes, guest_name, guests)')
    .eq('type', 'cleaning')
    .gte('scheduled_for', today)
    .neq('status', 'done')
    .order('scheduled_for', { ascending: true })

  // Done tasks: last 30 days
  const doneQ = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name), reservation:reservations(check_in, check_out, notes, guest_name, guests)')
    .eq('type', 'cleaning')
    .eq('status', 'done')
    .gte('scheduled_for', ago30)
    .order('completed_at', { ascending: false })

  const [activeRes, doneRes] = await Promise.all([activeQ, doneQ])
  if (activeRes.error) throw new Error(activeRes.error.message)
  if (doneRes.error)   throw new Error(doneRes.error.message)
  return [...(activeRes.data ?? []), ...(doneRes.data ?? [])]
}

// ── Weekly cleaning schedule ──────────────────────────────────────────────────

export interface WeekCleaningTask {
  id:            string
  scheduled_for: string          // YYYY-MM-DD
  property_name: string
  assignee_name: string | null
  status:        TaskStatus
  checkout_time: string          // display string, e.g. "12pm"
  guest_name:    string | null
}

/** Converts "HH:MM" or "12:00 p.m." / "12pm" to a compact "12pm" / "3:30pm". */
function displayTime(raw: string | null | undefined): string {
  if (!raw) return '12pm'
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/)
  let h: number, m: number
  if (h24) {
    h = parseInt(h24[1]); m = parseInt(h24[2])
  } else {
    const d = raw.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i)
    if (!d) return '12pm'
    h = parseInt(d[1]); m = d[2] ? parseInt(d[2]) : 0
    const p = d[3].toLowerCase()
    if (p === 'p' && h !== 12) h += 12
    if (p === 'a' && h === 12) h = 0
  }
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

/**
 * All cleaning tasks scheduled within a week [weekStart, weekStart+6 days],
 * any status, for the weekly schedule view. weekStart is a Monday (YYYY-MM-DD).
 */
export async function getWeekCleaningSchedule(weekStart: string): Promise<WeekCleaningTask[]> {
  const supabase = await createClient()
  const start = new Date(weekStart + 'T12:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const weekEnd = end.toISOString().slice(0, 10)

  const { data } = await supabase
    .from('tasks')
    .select('id, scheduled_for, status, notes, property:properties(name), assignee:team_members(name), reservation:reservations(notes, guest_name)')
    .eq('type', 'cleaning')
    .gte('scheduled_for', weekStart)
    .lte('scheduled_for', weekEnd)
    .order('scheduled_for')

  if (!data) return []

  return data.map(t => {
    const prop = Array.isArray(t.property) ? t.property[0] : t.property
    const assignee = Array.isArray(t.assignee) ? t.assignee[0] : t.assignee
    const res = Array.isArray(t.reservation) ? t.reservation[0] : t.reservation
    // Prefer the edited checkout time on the task ("HH:MM|..."), else reservation notes
    const taskTime = (t.notes as string | null)?.match(/^(\d{2}:\d{2})\|/)?.[1]
    const resTime  = (res?.notes as string | null)?.match(/Check-out:\s*([^|]+)/i)?.[1]?.trim()
    return {
      id:            t.id,
      scheduled_for: t.scheduled_for as string,
      property_name: prop?.name ?? '—',
      assignee_name: assignee?.name ?? null,
      status:        t.status as TaskStatus,
      checkout_time: displayTime(taskTime ?? resTime),
      guest_name:    res?.guest_name ?? null,
    }
  })
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
    .select('*, property:properties(name), assignee:team_members(name), reservation:reservations(check_in, check_out, notes, guest_name, guests)')
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

/** Saves a proof-of-clean photo URL on a task. */
export async function setTaskPhoto(
  taskId: string,
  photoUrl: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ photo_url: photoUrl })
    .eq('id', taskId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/cleaning')
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

/** Edits an existing task. Cost is optional (null when left blank). */
export async function updateTask(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const costRaw = formData.get('cost') as string
  const { error } = await supabase.from('tasks').update({
    property_id:   formData.get('property_id') as string,
    assigned_to:   (formData.get('assigned_to') as string) || null,
    scheduled_for: formData.get('scheduled_for') as string,
    notes:         (formData.get('notes') as string) || '',
    cost:          costRaw ? parseFloat(costRaw) : null,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').update({
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
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
 * Marks overdue cleaning/other tasks as "done" automatically.
 * Preparation tasks are intentionally excluded — they are shown on the
 * dashboard on the guest's check-in day regardless of scheduled_for,
 * so auto-completing them would hide them from that view.
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
    .lt('scheduled_for', today)
    .in('status', ['pending', 'in_progress'])
    .neq('type', 'preparation')        // prep tasks are managed manually
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
