import { getCleaningTasks, getWeekCleaningSchedule } from '@/actions/tasks'
import { getTeamMembers } from '@/actions/team'
import { getCurrentMember } from '@/lib/auth'
import { PageHeader } from '@/components/layout/PageHeader'
import { CleaningView } from '@/components/cleaning/CleaningView'

/** Monday (ISO) of the week containing `d`. */
function mondayOf(d: Date): string {
  const day = d.getDay()              // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return monday.toISOString().slice(0, 10)
}

export default async function CleaningPage() {
  const now       = new Date()
  const todayISO  = now.toISOString().slice(0, 10)
  const weekStart = mondayOf(now)

  const [tasks, staff, weekTasks, currentMember] = await Promise.all([
    getCleaningTasks(),
    getTeamMembers(),   // all roles — anyone can be assigned a cleaning
    getWeekCleaningSchedule(weekStart),
    getCurrentMember(),
  ])

  return (
    <>
      <PageHeader title="Limpieza" />
      <CleaningView
        tasks={tasks}
        staff={staff}
        weekTasks={weekTasks}
        weekStart={weekStart}
        todayISO={todayISO}
        currentMember={currentMember}
      />
    </>
  )
}
