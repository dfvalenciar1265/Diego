import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskStatus, TaskType } from '@/lib/types'

/**
 * End-of-day cleanup for tasks whose date already passed (runs inside the Gmail sync).
 *
 * Diego's rule (2026-10-12): a cleaning nobody started is "dada de baja" (deleted)
 * instead of being marked done — marking it done made it show up in the reports as
 * "Sin asignar" and paid at the fixed price. A cleaning someone started (in_progress)
 * was almost certainly done, so it's closed with its assignee. 'other' tasks keep
 * being auto-closed; preparations are managed by hand and never touched.
 *
 * Lives outside actions/ on purpose: it uses the service-role key, and anything
 * exported from a 'use server' file can be called from the browser.
 */

export interface OverdueCandidate {
  id: string
  type: TaskType
  status: TaskStatus
}

export function planOverdueTasks(tasks: OverdueCandidate[]): { drop: string[]; close: string[] } {
  const drop: string[] = []
  const close: string[] = []
  for (const t of tasks) {
    if (t.status === 'done' || t.type === 'preparation') continue
    if (t.type === 'cleaning' && t.status === 'pending') drop.push(t.id)
    else close.push(t.id)
  }
  return { drop, close }
}

export async function settleOverdueTasks(
  db: SupabaseClient,
  today: string,
): Promise<{ dropped: number; closed: number }> {
  const { data, error } = await db
    .from('tasks')
    .select('id, type, status')
    .lt('scheduled_for', today)
    .in('status', ['pending', 'in_progress'])
    .neq('type', 'preparation')
  if (error) {
    console.error('[settleOverdueTasks] select', error.message)
    return { dropped: 0, closed: 0 }
  }

  const { drop, close } = planOverdueTasks((data ?? []) as OverdueCandidate[])
  let dropped = 0
  let closed = 0

  if (drop.length > 0) {
    const { error: delError } = await db.from('tasks').delete().in('id', drop)
    if (delError) console.error('[settleOverdueTasks] delete', delError.message)
    else dropped = drop.length
  }
  if (close.length > 0) {
    const { error: updError } = await db
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .in('id', close)
    if (updError) console.error('[settleOverdueTasks] close', updError.message)
    else closed = close.length
  }

  return { dropped, closed }
}
