import { addDays } from './gpt-api/dates'
import type { PreparationArrival } from './preparation'
import type { TaskStatus } from './types'

/** Los indicadores y las tarjetas comparten filas y día colombiano; no cuentan etapas ni copias heredadas. */
export function dashboardSummary(today: string, arrivals: Pick<PreparationArrival, 'id' | 'status' | 'check_in'>[],
  departures: { id: string; cleaning: { task: { status: TaskStatus } | null; review: string | null } }[],
  otherTasks: { id: string; scheduled_for: string; status: TaskStatus }[]) {
  const currentArrivals = [...new Map(arrivals.filter(r => r.status === 'confirmed' && r.check_in >= today
    && r.check_in <= addDays(today, 1)).map(r => [r.id, r])).values()]
  const currentDepartures = [...new Map(departures.map(r => [r.id, r])).values()]
  const pendingCleaning = currentDepartures.filter(r => r.cleaning.review || r.cleaning.task?.status !== 'done')
  const pendingOther = new Set(otherTasks.filter(t => t.scheduled_for === today && t.status !== 'done').map(t => t.id))
  return {
    arrivalsToday: currentArrivals.filter(r => r.check_in === today).length,
    departuresToday: currentDepartures.length,
    pendingWork: pendingCleaning.length + pendingOther.size,
    unchecked: pendingCleaning.some(r => r.cleaning.review || !r.cleaning.task),
  }
}
