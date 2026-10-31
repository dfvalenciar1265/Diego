import { describe, expect, it } from 'vitest'
import { dashboardSummary } from '@/lib/dashboard-summary'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { checkout } from '../helpers/checkout'
import { preparationArrival, preparationState, preparationView } from '../helpers/preparation'

const today = '2027-02-10'
const arrival = preparationArrival()
describe('indicadores del mismo trabajo que se ve en Inicio', () => {
  it('cuenta una limpieza, una preparación por llegada y otras pendientes; mañana no es llegada de hoy', () => {
    const tomorrow = preparationArrival({ id: 'synthetic-tomorrow', check_in: '2027-02-11' })
    const c = checkout()
    const summary = dashboardSummary(today, [arrival, arrival, tomorrow, preparationArrival({ id: 'cancelled', status: 'cancelled' })],
      [c, c], { [arrival.id]: preparationView(), [tomorrow.id]: preparationView() }, [
        { id: 'pending', scheduled_for: today, status: 'pending' }, { id: 'pending', scheduled_for: today, status: 'pending' },
        { id: 'done', scheduled_for: today, status: 'done' }, { id: 'other-day', scheduled_for: '2027-02-11', status: 'pending' },
      ])
    expect(summary).toEqual({ arrivalsToday: 1, departuresToday: 1, pendingWork: 4, unchecked: false })
  })
  it('solo descuenta una preparación comprobada y lista, aunque su tarea heredada siga pendiente', () => {
    const c = checkout(); c.cleaning.task!.status = 'done'
    expect(dashboardSummary(today, [arrival], [c], { [arrival.id]: preparationView({
      state: preparationState({ ready_at: '2027-02-10T14:00:00Z' }), blockers: [],
    }) }, []).pendingWork).toBe(0)
    expect(dashboardSummary(today, [arrival], [], { [arrival.id]: preparationView({
      state: preparationState({ ready_at: '2027-02-10T14:00:00Z' }), blockers: ['Urgencia abierta.'],
    }) }, []).pendingWork).toBe(1)
  })
  it('los datos no comprobados o tareas ausentes cuentan como pendientes; no se presentan como completados', () => {
    const c = checkout(); c.cleaning.task = null; c.cleaning.review = 'Tarea por revisar'
    expect(dashboardSummary(today, [arrival], [c], {}, [])).toMatchObject({ pendingWork: 2, unchecked: true })
  })
  it('respeta el cambio de día y de mes de Bogotá, aunque UTC ya sea mañana', () => {
    const colombianDay = todayInBogota(new Date('2027-03-01T04:59:00Z'))
    const r = preparationArrival({ check_in: '2027-03-01' })
    expect(colombianDay).toBe('2027-02-28')
    expect(dashboardSummary(colombianDay, [r], [], { [r.id]: preparationView() }, []).arrivalsToday).toBe(0)
    expect(dashboardSummary(todayInBogota(new Date('2027-03-01T05:00:00Z')), [r], [], { [r.id]: preparationView() }, []).arrivalsToday).toBe(1)
  })
})
