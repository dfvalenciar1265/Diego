import { getCleaningTasks } from '@/actions/tasks'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { CleaningView } from '@/components/cleaning/CleaningView'

export default async function CleaningPage() {
  const [tasks, staff] = await Promise.all([
    getCleaningTasks(),
    getTeamMembers('cleaning'),
  ])

  return (
    <>
      <PageHeader title="Limpieza" />
      <CleaningView tasks={tasks} staff={staff} />
    </>
  )
}
