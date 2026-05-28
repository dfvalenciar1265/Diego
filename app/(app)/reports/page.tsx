import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportsView } from '@/components/reports/ReportsView'

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Reports are admin-only
  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  if (member?.role !== 'admin') redirect('/')

  // Last 90 days of completed cleaning tasks
  const ago90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)

  const { data: cleaningRows } = await supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name)')
    .eq('type', 'cleaning')
    .eq('status', 'done')
    .gte('completed_at', `${ago90}T00:00:00`)
    .order('completed_at', { ascending: false })

  // Maintenance expenses (resolved) — last 90 days
  const { data: maintenanceRows } = await supabase
    .from('maintenance')
    .select('*, property:properties(name), assignee:team_members!assigned_to(name)')
    .eq('status', 'resolved')
    .gte('resolved_at', `${ago90}T00:00:00`)
    .not('cost', 'is', null)
    .order('resolved_at', { ascending: false })

  // Other (misc) tasks with cost
  const { data: otherRows } = await supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name)')
    .eq('type', 'other')
    .eq('status', 'done')
    .gte('completed_at', `${ago90}T00:00:00`)
    .not('cost', 'is', null)
    .order('completed_at', { ascending: false })

  const [properties, teamMembers] = await Promise.all([
    getProperties(),
    getTeamMembers(),
  ])

  return (
    <>
      <PageHeader title="Reportes" />
      <ReportsView
        cleaningTasks={cleaningRows ?? []}
        maintenanceIssues={maintenanceRows ?? []}
        otherTasks={otherRows ?? []}
        properties={properties}
        teamMembers={teamMembers}
      />
    </>
  )
}
