import { describe, expect, it } from 'vitest'
import { advanceCheckoutCleaning } from '@/lib/gpt-api/checkout-cleaning'
import { fakeDb } from '../../helpers/fake-db'
import { checkout, cleanerId, otherCleanerId, adminId } from '../../helpers/checkout'

function fixture() {
  const co = checkout()
  const task = { ...co.cleaning.task!, type: 'cleaning' }
  const stay = { id: co.id, property_id: co.property_id, ...co.stay, status: 'confirmed' }
  const tables = { reservations: [stay], tasks: [task], arrival_preparations: [],
    team_members: [{ id: cleanerId, role: 'cleaning', active: true }, { id: otherCleanerId, role: 'cleaning', active: true }] }
  const input = { reservation_id: co.id, task_id: task.id, property_id: co.property_id, stay_check_in: co.stay.check_in,
    stay_check_out: co.stay.check_out, assigned_to: cleanerId, action: 'start' as 'start' | 'finish' }
  const now = new Date(`${co.stay.check_out}T14:00:00Z`)
  return { tables, task, input, now, db: fakeDb(tables) }
}
const actor = { id: cleanerId, role: 'cleaning' as const }
describe('proceso de limpieza de una salida desde Inicio', () => {
  it('inicia y termina la tarea existente; no altera notas, reservas ni certifica otra llegada', async () => {
    const f = fixture()
    expect(await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).toEqual({ success: true })
    expect(f.task).toMatchObject({ status: 'in_progress', assigned_to: cleanerId, completed_at: null })
    expect(await advanceCheckoutCleaning(f.db, { ...f.input, action: 'finish' }, actor, f.now)).toEqual({ success: true })
    expect(f.task).toMatchObject({ status: 'done', completed_at: f.now.toISOString() })
    expect(f.tables.tasks).toHaveLength(1)
    expect(f.tables.arrival_preparations).toEqual([])
    expect(f.tables.reservations[0].status).toBe('confirmed')
  })
  it('reintentos no duplican tareas ni sobrescriben la fecha de finalización', async () => {
    const f = fixture()
    await advanceCheckoutCleaning(f.db, f.input, actor, f.now)
    expect(await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).toEqual({ success: true })
    await advanceCheckoutCleaning(f.db, { ...f.input, action: 'finish' }, actor, f.now)
    expect(await advanceCheckoutCleaning(f.db, { ...f.input, action: 'finish' }, actor, new Date(f.now.getTime() + 60000))).toEqual({ success: true })
    expect(f.task.completed_at).toBe(f.now.toISOString())
    expect((await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).success).toBe(false)
  })
  it('dos inicios simultáneos no reasignan la limpieza al segundo usuario', async () => {
    const f = fixture()
    const results = await Promise.all([
      advanceCheckoutCleaning(f.db, f.input, { id: adminId, role: 'admin' }, f.now),
      advanceCheckoutCleaning(f.db, { ...f.input, assigned_to: otherCleanerId }, { id: adminId, role: 'admin' }, f.now),
    ])
    expect(results.filter(r => r.success)).toHaveLength(1)
    expect(f.task.assigned_to).toBe(cleanerId)
  })
  it.each(['cancelled', 'blocked'])('rechaza una reserva %s', async status => {
    const f = fixture(); f.tables.reservations[0].status = status
    expect((await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).success).toBe(false)
    expect(f.task.status).toBe('pending')
  })
  it('rechaza cambios de fecha/apartamento y tareas de otra reserva sin crear copias', async () => {
    for (const change of ['date', 'property', 'task', 'missing', 'duplicate']) {
      const f = fixture()
      if (change === 'date') f.tables.reservations[0].check_out = '2027-02-20'
      if (change === 'property') f.task.property_id = otherCleanerId
      if (change === 'task') f.input.task_id = otherCleanerId
      if (change === 'missing') f.tables.tasks.splice(0)
      if (change === 'duplicate') f.tables.tasks.push({ ...f.task, id: otherCleanerId })
      expect((await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).success).toBe(false)
      expect(f.tables.tasks.every(t => t.status === 'pending')).toBe(true)
    }
  })
  it('rechaza empezar o terminar antes del día colombiano de salida', async () => {
    const f = fixture()
    expect((await advanceCheckoutCleaning(f.db, f.input, actor, new Date(`${f.input.stay_check_out}T04:59:00Z`))).success).toBe(false)
    expect((await advanceCheckoutCleaning(f.db, f.input, actor, new Date(`${f.input.stay_check_out}T05:00:00Z`))).success).toBe(true)
  })
  it('mantenimiento no opera y limpieza solo puede actuar sobre sí misma', async () => {
    const f = fixture()
    expect((await advanceCheckoutCleaning(f.db, f.input, { id: cleanerId, role: 'maintenance' }, f.now)).success).toBe(false)
    expect((await advanceCheckoutCleaning(f.db, { ...f.input, assigned_to: otherCleanerId }, actor, f.now)).success).toBe(false)
    f.task.assigned_to = otherCleanerId
    expect((await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).success).toBe(false)
    expect(f.task.status).toBe('pending')
  })
  it('exige persona activa y muestra un error si no se puede comprobar la reserva', async () => {
    const f = fixture(); f.tables.team_members[0].active = false
    expect((await advanceCheckoutCleaning(f.db, f.input, actor, f.now)).success).toBe(false)
    expect((await advanceCheckoutCleaning(fakeDb(f.tables, { failSelectOnce: 'reservations' }), f.input, actor, f.now)).success).toBe(false)
    expect(f.task.status).toBe('pending')
  })
})
