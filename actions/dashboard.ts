import { createClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import type { DashboardKPIs, OccupancyData } from '@/lib/types'
import { getOccupiedDaysInWeek } from '@/lib/utils'

export interface TodayCheckOut {
  id: string
  guest_name: string
  check_out_time: string   // extracted from notes, e.g. "12:00 p.m."
  property_name: string
}

/**
 * Returns today's confirmed check-outs with property name and the
 * check-out time extracted from the reservation notes field.
 * Notes format: "... | Check-out: 12:00 p.m."
 */
/** Normalizes any time string to "7am", "12pm", "3:30pm" etc. */
function normalizeTime(raw: string | null | undefined): string {
  if (!raw) return '12pm'
  // Already HH:MM (from task notes)
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const h = parseInt(h24[1])
    const m = parseInt(h24[2])
    const suffix = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2,'0')}${suffix}`
  }
  // "12:00 p.m." / "3:00 p.m." / "12:00 a.m."
  const dotted = raw.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i)
  if (dotted) {
    let h = parseInt(dotted[1])
    const m = dotted[2] ? parseInt(dotted[2]) : 0
    const period = dotted[3].toLowerCase()
    if (period === 'p' && h !== 12) h += 12
    if (period === 'a' && h === 12) h = 0
    const suffix = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2,'0')}${suffix}`
  }
  return raw.trim()
}

export async function getTodayCheckOuts(): Promise<TodayCheckOut[]> {
  const supabase = await createClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data } = await supabase
    .from('reservations')
    .select(`id, guest_name, notes, property:properties(name), tasks(notes, type, scheduled_for)`)
    .eq('check_out', today)
    .eq('status', 'confirmed')
    .order('guest_name')
  if (!data) return []

  return data.map(r => {
    // 1. Prefer time saved on cleaning task ("HH:MM|..." format)
    const cleaningTask = (r.tasks as any[])?.find(
      (t: any) => t.type === 'cleaning' && t.scheduled_for === today
    )
    const taskTimeMatch = cleaningTask?.notes?.match(/^(\d{2}:\d{2})\|/)
    const rawTime = taskTimeMatch
      ? taskTimeMatch[1]                                          // "07:00" from task
      : r.notes?.match(/Check-out:\s*([^\|]+)/i)?.[1] ?? null    // from reservation notes

    return {
      id: r.id,
      guest_name: r.guest_name ?? '—',
      check_out_time: normalizeTime(rawTime),  // always same format: "7am", "12pm"
      property_name: (r.property as any)?.name ?? '—',
    }
  })
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const supabase = await createClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  const [checkIns, checkOuts, pendingTasks, monthlyRevenue] = await Promise.all([
    // Check-ins hoy
    supabase.from('reservations').select('id', { count: 'exact', head: true })
      .eq('check_in', today).eq('status', 'confirmed'),
    // Check-outs hoy
    supabase.from('reservations').select('id', { count: 'exact', head: true })
      .eq('check_out', today).eq('status', 'confirmed'),
    // Tareas pendientes hoy
    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'in_progress'])
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
