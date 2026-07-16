import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMember } from '@/lib/auth'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { getIncomeReport, getCleaningCostReport, getProfitabilityReport, getCleaningByEmployee } from '@/actions/reports'
import { getExpenses } from '@/actions/expenses'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportsView } from '@/components/reports/ReportsView'

export default async function ReportsPage() {
  // Admin-only — cached per request
  const member = await getCurrentMember()
  if (!member) redirect('/login')
  if (member.role !== 'admin') redirect('/')

  const supabase = await createClient()

  const now          = new Date()
  const currentYear  = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Last 90 days for legacy tabs
  const ago90 = new Date(now.getTime() - 90 * 86400_000).toISOString().slice(0, 10)

  const [
    cleaningResult,
    properties,
    teamMembers,
    incomeRows,
    cleaningCostRows,
    profitabilityRows,
    employeeCleaningRows,
    expenses,
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, property:properties(name), assignee:team_members(name)')
      .eq('type', 'cleaning')
      .eq('status', 'done')
      .gte('completed_at', `${ago90}T00:00:00`)
      .order('completed_at', { ascending: false }),

    getProperties(true),
    getTeamMembers(),
    getIncomeReport(currentYear, currentMonth),
    getCleaningCostReport(currentYear, currentMonth),
    getProfitabilityReport(currentYear, currentMonth),
    getCleaningByEmployee(currentYear, currentMonth),
    getExpenses({ year: currentYear, month: currentMonth }),
  ])

  return (
    <>
      <PageHeader title="Reportes" />
      <ReportsView
        cleaningTasks={cleaningResult.data ?? []}
        properties={properties}
        teamMembers={teamMembers}
        incomeRows={incomeRows}
        cleaningCostRows={cleaningCostRows}
        profitabilityRows={profitabilityRows}
        employeeCleaningRows={employeeCleaningRows}
        currentYear={currentYear}
        currentMonth={currentMonth}
        expenses={expenses}
      />
    </>
  )
}
