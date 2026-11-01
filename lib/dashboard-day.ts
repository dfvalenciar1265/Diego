import { addDays, hourInBogota, todayInBogota } from './gpt-api/dates'

/** Solo cambia la vista de Inicio: el día real de las escrituras sigue siendo el de Bogotá. */
export function dashboardDay(now = new Date()) {
  const today = todayInBogota(now)
  const tomorrow = hourInBogota(now) >= 19
  const date = tomorrow ? addDays(today, 1) : today
  return {
    today, date, tomorrow, label: tomorrow ? 'mañana' : 'hoy', key: `${today}:${date}`,
    nextChangeAt: Date.parse(tomorrow ? `${date}T00:00:00-05:00` : `${today}T19:00:00-05:00`),
  }
}
