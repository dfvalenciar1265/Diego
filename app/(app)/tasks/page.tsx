import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { canDo } from '@/lib/permissions'
import { getTasks } from '@/actions/tasks'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { TasksClient } from '@/components/tasks/TasksClient'
import { TasksView } from '@/components/tasks/TasksView'

export default async function TasksPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/logout')

  // Anyone who can create tasks sees the full shared 'other' task list;
  // others see only the tasks assigned to them.
  const canManageTasks = canDo(member.role, 'tasks:create')
  // Only 'other' tasks live on this screen — cleaning/prep have their own views,
  // so don't ship the whole task history to the browser.
  const filters = canManageTasks
    ? { type: 'other' as const }
    : { type: 'other' as const, assignedTo: member.id }
  const [tasks, properties, teamMembers] = await Promise.all([
    getTasks(filters),
    getProperties(true),
    getTeamMembers(),
  ])

  return (
    <>
      <PageHeader
        title="Tareas"
        action={canManageTasks ? (
          <TasksClient properties={properties} teamMembers={teamMembers} />
        ) : null}
      />
      <TasksView tasks={tasks} properties={properties} teamMembers={teamMembers} />
    </>
  )
}
