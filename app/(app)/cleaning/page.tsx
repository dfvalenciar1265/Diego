import { todayInBogota, addDays as addDaysISO } from '@/lib/gpt-api/dates'
import { getCleaningTasks, getWeekCleaningSchedule } from '@/actions/tasks'
import { getTeamMembers } from '@/actions/team'
import { getCurrentMember } from '@/lib/auth'
import { PageHeader } from '@/components/layout/PageHeader'
import { CleaningView } from '@/components/cleaning/CleaningView'

/** Monday (YYYY-MM-DD) of the week containing the date `iso`. */
function mondayOf(iso: string): string {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay()   // 0 = Sun … 6 = Sat
  return addDaysISO(iso, day === 0 ? -6 : 1 - day)
}

export default async function CleaningPage() {
  const todayISO  = todayInBogota()   // Colombia's day, not UTC's
  const weekStart = mondayOf(todayISO)

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
