import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { getIncomeReport, getCleaningCostReport } from '@/actions/reports'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportsView } from '@/components/reports/ReportsView'

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Admin-only
  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  if (member?.role !== 'admin') redirect('/')

  const now          = new Date()
  const currentYear  = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Last 90 days for legacy tabs
  const ago90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)

  const [
    cleaningResult,
    maintenanceResult,
    otherResult,
    properties,
    teamMembers,
    incomeRows,
    cleaningCostRows,
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, property:properties(name), assignee:team_members(name)')
      .eq('type', 'cleaning')
      .eq('status', 'done')
      .gte('completed_at', `${ago90}T00:00:00`)
      .order('completed_at', { ascending: false }),

    supabase
      .from('maintenance')
      .select('*, property:properties(name), assignee:team_members!assigned_to(name)')
      .eq('status', 'resolved')
      .gte('resolved_at', `${ago90}T00:00:00`)
      .not('cost', 'is', null)
      .order('resolved_at', { ascending: false }),

    supabase
      .from('tasks')
      .select('*, property:properties(name), assignee:team_members(name)')
      .eq('type', 'other')
      .eq('status', 'done')
      .gte('completed_at', `${ago90}T00:00:00`)
      .not('cost', 'is', null)
      .order('completed_at', { ascending: false }),

    getProperties(true),
    getTeamMembers(),
    getIncomeReport(currentYear, currentMonth),
    getCleaningCostReport(currentYear, currentMonth),
  ])

  return (
    <>
      <PageHeader title="Reportes" />
      <ReportsView
        cleaningTasks={cleaningResult.data ?? []}
        maintenanceIssues={maintenanceResult.data ?? []}
        otherTasks={otherResult.data ?? []}
        properties={properties}
        teamMembers={teamMembers}
        incomeRows={incomeRows}
        cleaningCostRows={cleaningCostRows}
        currentYear={currentYear}
        currentMonth={currentMonth}
      />
    </>
  )
}
