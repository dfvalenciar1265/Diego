import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getTasks } from '@/actions/tasks'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { TasksClient } from '@/components/tasks/TasksClient'
import { TasksView } from '@/components/tasks/TasksView'

export default async function TasksPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/login')

  // Admin sees all 'other' tasks; team sees only their own
  const filters = member.role !== 'admin' ? { assignedTo: member.id } : {}
  const [tasks, properties, teamMembers] = await Promise.all([
    getTasks(filters),
    getProperties(true),
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
