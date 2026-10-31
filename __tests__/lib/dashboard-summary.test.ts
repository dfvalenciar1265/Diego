import { describe, expect, it } from 'vitest'
import { dashboardSummary } from '@/lib/dashboard-summary'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { checkout } from '../helpers/checkout'
import { preparationArrival } from '../helpers/preparation'

const today = '2027-02-10'
const arrival = preparationArrival()
describe('indicadores del mismo trabajo que se ve en Inicio', () => {
  it('cuenta limpieza y otras tareas una vez; mañana no es llegada de hoy', () => {
    const tomorrow = preparationArrival({ id: 'synthetic-tomorrow', check_in: '2027-02-11' })
    const c = checkout()
    const summary = dashboardSummary(today, [arrival, arrival, tomorrow, preparationArrival({ id: 'cancelled', status: 'cancelled' })],
      [c, c], [
        { id: 'pending', scheduled_for: today, status: 'pending' }, { id: 'pending', scheduled_for: today, status: 'pending' },
        { id: 'done', scheduled_for: today, status: 'done' }, { id: 'other-day', scheduled_for: '2027-02-11', status: 'pending' },
      ])
    expect(summary).toEqual({ arrivalsToday: 1, departuresToday: 1, pendingWork: 2, unchecked: false })
  })
  it('las etapas retiradas de la portada no dejan pendientes imposibles de completar desde ella', () => {
    const c = checkout(); c.cleaning.task!.status = 'done'
    expect(dashboardSummary(today, [arrival], [c], []).pendingWork).toBe(0)
    expect(dashboardSummary(today, [arrival], [], []).pendingWork).toBe(0)
  })
  it('una limpieza ausente cuenta como pendiente por revisar, sin presentarla completada', () => {
    const c = checkout(); c.cleaning.task = null; c.cleaning.review = 'Tarea por revisar'
    expect(dashboardSummary(today, [arrival], [c], [])).toMatchObject({ pendingWork: 1, unchecked: true })
  })
  it('respeta el cambio de día y de mes de Bogotá, aunque UTC ya sea mañana', () => {
    const colombianDay = todayInBogota(new Date('2027-03-01T04:59:00Z'))
    const r = preparationArrival({ check_in: '2027-03-01' })
    expect(colombianDay).toBe('2027-02-28')
    expect(dashboardSummary(colombianDay, [r], [], []).arrivalsToday).toBe(0)
    expect(dashboardSummary(todayInBogota(new Date('2027-03-01T05:00:00Z')), [r], [], []).arrivalsToday).toBe(1)
  })
})
