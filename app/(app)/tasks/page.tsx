import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTasks } from '@/actions/tasks'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { TasksClient } from '@/components/tasks/TasksClient'
import { TasksView } from '@/components/tasks/TasksView'

export default async function TasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('team_members').select('*').eq('id', user!.id).single()

  // Admin sees all 'other' tasks; team sees only their own
  const filters = member?.role !== 'admin' ? { assignedTo: user!.id } : {}
  const [tasks, properties, teamMembers] = await Promise.all([
    getTasks(filters),
    getProperties(),
    getTeamMembers(),
  ])

  return (
    <>
      <PageHeader
        title="Tareas"
        action={member?.role === 'admin' ? (
          <TasksClient properties={properties} teamMembers={teamMembers} />
        ) : null}
      />
      <TasksView tasks={tasks} properties={properties} teamMembers={teamMembers} />
    </>
  )
}
