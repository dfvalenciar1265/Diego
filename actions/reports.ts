'use server'
import { createClient } from '@/lib/supabase/server'
import { CLEANING_PRICES } from '@/lib/cleaning-prices'
import { getExpenses } from '@/actions/expenses'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncomeRow {
  id:            string
  property_id:   string
  property_name: string
  guest_name:    string
  check_in:      string
  check_out:     string
  total_amount:  number
  total_nights:  number
  p1_nights:     number   // nights in days 1-15 of the month
  p2_nights:     number   // nights in days 16-end of the month
  p1_amount:     number   // proportional income for Q1
  p2_amount:     number   // proportional income for Q2
}

export interface CleaningCostRow {
  id:            string
  property_id:   string
  property_name: string
  completed_at:  string
  period:        1 | 2
  fixed_price:   number
  actual_cost:   number
}

export interface ProfitabilityRow {
  property_id:      string
  property_name:    string
  income:           number   // proportional income earned this month
  cleaning_cost:    number   // cleaning labour cost this month
  expenses:         number   // other expenses logged this month
  maintenance_cost: number   // maintenance resolved this month (by resolved_at)
  net:              number   // income − cleaning − expenses − maintenance
  reservations:     number   // # of reservations contributing income
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// ── Income report ─────────────────────────────────────────────────────────────

/**
 * Returns all confirmed reservations that have at least one night in the given
 * month, with Q1 (days 1-15) and Q2 (days 16-end) proportional amounts.
 */
export async function getIncomeReport(year: number, month: number): Promise<IncomeRow[]> {
  const supabase = await createClient()

  const firstDay = `${year}-${pad(month)}-01`
  const lastDay  = `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`

  const { data } = await supabase
    .from('reservations')
    .select('*, property:properties(name)')
    .eq('status', 'confirmed')
    .lte('check_in', lastDay)   // reservation starts on or before last day of month
    .gt('check_out', firstDay)  // reservation ends after first day of month
    .order('check_in')

  if (!data) return []

  const result: IncomeRow[] = []

  for (const r of data) {
    const checkIn  = new Date(r.check_in  + 'T12:00:00')
    const checkOut = new Date(r.check_out + 'T12:00:00')
    const totalNights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000)
    if (totalNights <= 0) continue

    // Count nights that fall in Q1 and Q2 of the selected month
    let p1 = 0
    let p2 = 0
    const cur = new Date(checkIn)
    while (cur < checkOut) {
      if (cur.getFullYear() === year && cur.getMonth() + 1 === month) {
        if (cur.getDate() <= 15) p1++; else p2++
      }
      cur.setDate(cur.getDate() + 1)
    }

    if (p1 + p2 === 0) continue  // no nights in this month (shouldn't happen, but guard)

    result.push({
      id:            r.id,
      property_id:   r.property_id,
      property_name: r.property?.name ?? '—',
      guest_name:    r.guest_name,
      check_in:      r.check_in,
      check_out:     r.check_out,
      total_amount:  r.amount,
      total_nights:  totalNights,
      p1_nights:     p1,
      p2_nights:     p2,
      p1_amount:     Math.round((p1 / totalNights) * r.amount),
      p2_amount:     Math.round((p2 / totalNights) * r.amount),
    })
  }

  return result
}

// ── Cleaning cost report ──────────────────────────────────────────────────────

/**
 * Returns all done cleaning tasks whose check-out (scheduled_for) falls in the
 * given month. Attribution is by check-out date, NOT by when the task was marked
 * done — a late or bulk completion must not drag the cleaning into another month
 * (that's what made June cleanings show up in July). scheduled_for is a plain
 * date, so there is also no timezone/quincena-boundary ambiguity.
 * Cost = task.cost if set, otherwise the fixed price for the property.
 */
export async function getCleaningCostReport(year: number, month: number): Promise<CleaningCostRow[]> {
  const supabase = await createClient()

  const firstDay = `${year}-${pad(month)}-01`
  const lastDay  = `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`

  const { data } = await supabase
    .from('tasks')
    .select('*, property:properties(name)')
    .eq('type', 'cleaning')
    .eq('status', 'done')
    .gte('scheduled_for', firstDay)
    .lte('scheduled_for', lastDay)
    .order('scheduled_for')

  if (!data) return []

  return data.map(t => {
    const day        = parseInt(String(t.scheduled_for).slice(8, 10), 10)
    const propName   = t.property?.name ?? ''
    const fixedPrice = CLEANING_PRICES[propName] ?? 0

    return {
      id:            t.id,
      property_id:   t.property_id,
      property_name: propName,
      completed_at:  t.completed_at,
      period:        day <= 15 ? 1 : 2,
      fixed_price:   fixedPrice,
      actual_cost:   t.cost ?? fixedPrice,
    }
  })
}

// ── Cleaning by employee (payroll per fortnight) ──────────────────────────────

export interface EmployeeCleaningRow {
  id:            string
  employee_id:   string | null
  employee_name: string        // 'Sin asignar' if the task had no assignee
  property_name: string
  completed_at:  string
  day:           number        // day-of-month of the check-out (for distinct-days)
  period:        1 | 2         // quincena: 1 = days 1–15, 2 = days 16–end
  value:         number        // task.cost override, else the property's fixed price
}

/**
 * All done cleaning tasks whose check-out (scheduled_for) falls in the month, one
 * row per task, with the employee who did it and the value paid. Attributed by
 * check-out date and value (cost ?? fixed) exactly like getCleaningCostReport, so
 * the two reports always agree. "Días laborados" therefore counts distinct
 * check-out days — a fair proxy for work days, and immune to bulk completions
 * that stamp many tasks done on a single day. Aggregation happens in the component.
 */
export async function getCleaningByEmployee(year: number, month: number): Promise<EmployeeCleaningRow[]> {
  const supabase = await createClient()

  const firstDay = `${year}-${pad(month)}-01`
  const lastDay  = `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`

  const { data } = await supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name)')
    .eq('type', 'cleaning')
    .eq('status', 'done')
    .gte('scheduled_for', firstDay)
    .lte('scheduled_for', lastDay)
    .order('scheduled_for')

  if (!data) return []

  return data.map(t => {
    const day      = parseInt(String(t.scheduled_for).slice(8, 10), 10)
    const propName = t.property?.name ?? ''
    const fixed    = CLEANING_PRICES[propName] ?? 0

    return {
      id:            t.id,
      employee_id:   t.assigned_to ?? null,
      employee_name: t.assignee?.name ?? 'Sin asignar',
      property_name: propName,
      completed_at:  t.completed_at,
      day,
      period:        (day <= 15 ? 1 : 2) as 1 | 2,
      value:         t.cost ?? fixed,
    }
  })
}

// ── Profitability (P&L per property) ──────────────────────────────────────────

/**
 * Net profit per property for a month: income − cleaning cost − expenses.
 * Reuses the existing income / cleaning-cost / expense reports (single source
 * of truth) and aggregates them per property. Sorted by net profit desc.
 */
export async function getProfitabilityReport(
  year: number,
  month: number
): Promise<ProfitabilityRow[]> {
  const firstDay = `${year}-${pad(month)}-01`
  const lastDay  = `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`

  const [income, cleaning, expenses, maintenance] = await Promise.all([
    getIncomeReport(year, month),
    getCleaningCostReport(year, month),
    getExpenses({ year, month }),
    // Maintenance cost = issues resolved this month (attributed by resolved_at)
    (async () => {
      const supabase = await createClient()
      const { data } = await supabase
        .from('maintenance')
        .select('property_id, cost, property:properties(name)')
        .eq('status', 'resolved')
        .gte('resolved_at', `${firstDay}T00:00:00`)
        .lte('resolved_at', `${lastDay}T23:59:59`)
      return data ?? []
    })(),
  ])

  const map = new Map<string, ProfitabilityRow>()
  const row = (id: string, name: string): ProfitabilityRow => {
    let r = map.get(id)
    if (!r) {
      r = { property_id: id, property_name: name, income: 0, cleaning_cost: 0, expenses: 0, maintenance_cost: 0, net: 0, reservations: 0 }
      map.set(id, r)
    }
    return r
  }

  // Income — proportional amount that falls in this month (p1 + p2)
  for (const i of income) {
    const r = row(i.property_id, i.property_name)
    r.income += i.p1_amount + i.p2_amount
    r.reservations++
  }

  // Cleaning labour cost
  for (const c of cleaning) {
    const r = row(c.property_id, c.property_name)
    r.cleaning_cost += c.actual_cost
  }

  // Other expenses (provider invoices, repairs logged as expenses, etc.)
  for (const e of expenses) {
    const name = e.property?.name ?? '—'
    const r = row(e.property_id, name)
    r.expenses += e.amount
  }

  // Maintenance resolved this month (PostgREST may return the join as object or array)
  for (const m of maintenance) {
    const prop = Array.isArray(m.property) ? m.property[0] : m.property
    const r = row(m.property_id, prop?.name ?? '—')
    r.maintenance_cost += m.cost ?? 0
  }

  for (const r of map.values()) {
    r.net = r.income - r.cleaning_cost - r.expenses - r.maintenance_cost
  }

  return [...map.values()].sort((a, b) => b.net - a.net)
}
