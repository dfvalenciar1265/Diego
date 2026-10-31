import { todayInBogota } from '@/lib/gpt-api/dates'
import { createClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import type { DashboardKPIs, OccupancyData } from '@/lib/types'
import { getOccupiedDaysInWeek } from '@/lib/utils'
import { resolveReservationTiming, type ReservationTiming, type TimeEvent } from '@/lib/reservation-times'
import type { CheckoutCleaningTask } from '@/lib/checkout-cleaning'

export interface TodayCheckOut {
  timing: ReservationTiming
  stay: { check_in: string; check_out: string }
  id: string
  guest_name: string
  check_out_time: string      // display, e.g. "12pm"
  check_out_time_24: string   // "HH:MM" for the time input
  property_name: string
  guests: number | null
  cleaning_task_id: string | null  // where the editable check-out time is stored
  property_id: string
  cleaning: { task: CheckoutCleaningTask | null; review: string | null }
}

/**
 * Returns today's confirmed check-outs with property name and check-out time: the exception
 * set in the app on today's cleaning task, else the standard 11:00 (never the reservation notes).
 */
/** Parses any time string ("07:00", "12pm", "12:00 p.m.") to 24h parts, or null. */
function parseTimeParts(raw: string | null | undefined): { h: number; m: number } | null {
  if (!raw) return null
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) return { h: parseInt(h24[1]), m: parseInt(h24[2]) }
  const dotted = raw.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i)
  if (dotted) {
    let h = parseInt(dotted[1])
    const m = dotted[2] ? parseInt(dotted[2]) : 0
    const period = dotted[3].toLowerCase()
    if (period === 'p' && h !== 12) h += 12
    if (period === 'a' && h === 12) h = 0
    return { h, m }
  }
  return null
}

/** "7am", "12pm", "3:30pm" */
function toDisplayTime(parts: { h: number; m: number } | null): string {
  if (!parts) return '11am'
  const suffix = parts.h >= 12 ? 'pm' : 'am'
  const h12 = parts.h % 12 || 12
  return parts.m === 0 ? `${h12}${suffix}` : `${h12}:${String(parts.m).padStart(2, '0')}${suffix}`
}

/** "HH:MM" for an <input type="time"> */
function to24hInput(parts: { h: number; m: number } | null): string {
  if (!parts) return '11:00'
  return `${String(parts.h).padStart(2, '0')}:${String(parts.m).padStart(2, '0')}`
}

export async function getTodayCheckOuts(today = todayInBogota()): Promise<TodayCheckOut[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('reservations')
    .select(`id, property_id, check_in, check_out, status, time_version, time_events:reservation_time_events(*), guest_name, notes, guests, property:properties(name), tasks(id, property_id, reservation_id, notes, type, scheduled_for, status, assigned_to, completed_at, assignee:team_members(name))`)
    .eq('check_out', today)
    .eq('status', 'confirmed')
    .order('guest_name')
  if (error) throw new Error(error.message)
  if (!data) return []

  type CheckoutTaskRow = CheckoutCleaningTask & { type: string; notes: string | null; assignee: { name: string } | { name: string }[] | null }
  type CheckoutRow = {
    property_id: string; check_in: string; check_out: string; status: string; time_version?: number; time_events: TimeEvent[]
    id: string
    guest_name: string | null
    notes: string | null
    guests: number | null
    property: { name: string } | { name: string }[] | null
    tasks: CheckoutTaskRow[] | null
  }

  return (data as CheckoutRow[]).map(r => {
    // The editable check-out time lives on today's cleaning task ("HH:MM|...").
    const cleaningTasks = r.tasks?.filter(t => t.type === 'cleaning') ?? []
    const cleaningTask = cleaningTasks.length === 1 && cleaningTasks[0].scheduled_for === today
      && cleaningTasks[0].property_id === r.property_id ? cleaningTasks[0] : undefined
    const timing = resolveReservationTiming(r, 'checkout', cleaningTask)
    const parts = parseTimeParts(timing.effective_time)
    const prop = Array.isArray(r.property) ? r.property[0] : r.property
    return {
      id: r.id,
      property_id: r.property_id,
      timing,
      stay: { check_in: r.check_in, check_out: r.check_out },
      guest_name: r.guest_name ?? '—',
      check_out_time: toDisplayTime(parts),
      check_out_time_24: to24hInput(parts),
      property_name: prop?.name ?? '—',
      guests: r.guests ?? null,
      cleaning_task_id: cleaningTask?.id ?? null,
      cleaning: {
        task: cleaningTask ? {
          id: cleaningTask.id, property_id: r.property_id, reservation_id: r.id, scheduled_for: cleaningTask.scheduled_for,
          status: cleaningTask.status, assigned_to: cleaningTask.assigned_to, completed_at: cleaningTask.completed_at,
          assignee_name: (Array.isArray(cleaningTask.assignee) ? cleaningTask.assignee[0] : cleaningTask.assignee)?.name ?? null,
        } : null,
        review: cleaningTask ? null : cleaningTasks.length > 1 ? 'Hay varias tareas de limpieza. Revísalas antes de iniciar; ninguna se eligió ni borró.'
          : cleaningTasks.length ? 'La tarea de limpieza corresponde a otra fecha o apartamento.' : 'Falta la tarea de limpieza. Revisa en Limpieza.',
      },
    }
  })
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const supabase = await createClient()
  const today = todayInBogota()
  const todayDate = new Date(today + 'T12:00:00')
  const monthStart = format(startOfMonth(todayDate), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(todayDate), 'yyyy-MM-dd')

  const [checkIns, checkOuts, pendingTasks, monthlyRevenue] = await Promise.all([
    // Check-ins hoy
    supabase.from('reservations').select('id', { count: 'exact', head: true })
      .eq('check_in', today).eq('status', 'confirmed'),
    // Check-outs hoy
    supabase.from('reservations').select('id', { count: 'exact', head: true })
      .eq('check_out', today).eq('status', 'confirmed'),
    // Tareas pendientes hoy — solo 'other' (lo que muestra la pantalla Tareas)
    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'in_progress'])
      .eq('type', 'other')
      .eq('scheduled_for', today),
    supabase.from('reservations').select('amount')
      .gte('check_in', monthStart).lte('check_in', monthEnd)
      .eq('status', 'confirmed'),
  ])

  const revenue = (monthlyRevenue.data ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return {
    checkInsToday: checkIns.count ?? 0,
    checkOutsToday: checkOuts.count ?? 0,
    pendingTasks: pendingTasks.count ?? 0,
    monthlyRevenue: revenue,
  }
}

export async function getWeekOccupancy(): Promise<OccupancyData[]> {
  const supabase = await createClient()
  const today = new Date()
  const weekStart = format(today, 'yyyy-MM-dd')
  const weekEnd = format(new Date(today.getTime() + 7 * 86400000), 'yyyy-MM-dd')

  const [{ data: properties }, { data: reservations }] = await Promise.all([
    supabase.from('properties').select('*').order('name'),
    supabase.from('reservations').select('property_id, check_in, check_out')
      .lte('check_in', weekEnd).gte('check_out', weekStart)
      .eq('status', 'confirmed'),
  ])

  return (properties ?? []).map(p => {
    const propReservations = (reservations ?? []).filter(r => r.property_id === p.id)
    const occupied = propReservations.reduce((sum, r) =>
      sum + getOccupiedDaysInWeek(r.check_in, r.check_out, weekStart, weekEnd), 0)
    return { property: p, daysOccupied: occupied, totalDays: 7 }
  })
}
