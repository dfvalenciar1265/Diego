import { describe, expect, it } from 'vitest'
import { resolveReservationTiming, annotationTime } from '@/lib/reservation-times'
import { timingReservation as r, timeEvent as event } from '../helpers/timing'
import { checkinSlot, checkoutSlot, type TurnoverReservation } from '@/lib/gpt-api/turnovers'

const resolve = (events = [event()]) => resolveReservationTiming({ ...r, time_events: events }, 'checkin')
describe('horarios separados', () => {
  it('una ETA temprana no autoriza entrada', () => {
    const result = resolve()
    expect(result).toMatchObject({ effective_time: '15:00', estimate: { time: '09:00', author: 'Admin Sintético' }, authorization: null })
    expect(result.review.join(' ')).toContain('no autoriza')
    expect(result.standard).toMatchObject({ reservation_id: r.id, service_date: r.check_in, source: 'operation_policy' })
  })
  it('una excepción explícita sí cambia la hora, sin perder la ETA', () => {
    expect(resolve([event(), event({ id: 'e2', version: 2, kind: 'authorization', time: '13:00' })]))
      .toMatchObject({ effective_time: '13:00', estimate: { time: '09:00' }, authorization: { time: '13:00' } })
  })
  it('Gmail no sustituye un ajuste manual aunque se importe después; la contradicción es visible', () => {
    const result = resolve([event({ version: 2 }), event({ id: 'e3', source: 'gmail', time: '12:00', version: 3, observed_at: '2026-10-30T04:00:00Z' })])
    expect(result.estimate?.time).toBe('09:00')
    expect(result.review.join(' ')).toContain('contradice')
    expect(result.history).toHaveLength(2)
  })
  it('los correos fuera de orden se resuelven por fecha del correo', () => {
    expect(resolve([event({ source: 'gmail', time: '18:00', observed_at: '2026-10-29T20:00:00Z' }),
      event({ id: 'e2', source: 'gmail', version: 2, time: '10:00', observed_at: '2026-10-28T20:00:00Z' })]).estimate?.time).toBe('18:00')
  })
  it('horarios de plataforma y notas antiguas no se convierten en ETA', () => {
    const result = resolveReservationTiming({ ...r, notes: 'Check-in: 9am | Check-out: 12pm' }, 'checkin')
    expect(result).toMatchObject({ effective_time: '15:00', estimate: null, platform: { time: '09:00' } })
    expect(result.review.join(' ')).toContain('no constituye autorización')
  })
  it.each(['check_in', 'check_out', 'property_id', 'status'] as const)('un cambio de %s no reutiliza el horario', field => {
    const value = field === 'status' ? 'cancelled' : field === 'property_id' ? 'otra' : '2027-02-12'
    const result = resolveReservationTiming({ ...r, [field]: value, time_events: [event({ kind: 'authorization' })] }, 'checkin')
    expect(result.effective_time).toBe('15:00')
    expect(result.review.length).toBeGreaterThan(0)
  })
  it('la invalidación persiste aunque se vuelva a las fechas anteriores; el legado no la elude', () => {
    const result = resolveReservationTiming({ ...r, time_events: [event({ kind: 'authorization', invalidated_at: '2026-10-30T06:00:00Z' })] }, 'checkin', { id: 't1', notes: '09:00|' })
    expect(result.authorization).toBeNull()
  })
  it('retirar una excepción vuelve al estándar y conserva historial', () => {
    const result = resolve([event({ kind: 'authorization' }), event({ id: 'e2', version: 2, kind: 'authorization', time: null })])
    expect(result.effective_time).toBe('15:00')
    expect(result.history).toHaveLength(2)
  })
  it('no mezcla otra reserva ni llegada y salida', () => {
    expect(resolve([event({ reservation_id: 'ajena', kind: 'authorization' }), event({ direction: 'checkout', kind: 'authorization' })]).effective_time).toBe('15:00')
    expect(resolveReservationTiming({ ...r, time_events: [event({ kind: 'authorization' })] }, 'checkout').effective_time).toBe('11:00')
  })
  it('salida estimada tardía requiere autorización', () => {
    const result = resolveReservationTiming({ ...r, time_events: [event({ direction: 'checkout', time: '14:00' })] }, 'checkout')
    expect(result).toMatchObject({ effective_time: '11:00', authorization: null })
    expect(result.review.join(' ')).toContain('requiere autorización')
  })
  it('dos excepciones heredadas distintas no se escogen arbitrariamente', () => {
    const result = resolve([event({ kind: 'authorization', source: 'legacy', time: '12:00' }), event({ id: 'e2', version: 2, kind: 'authorization', source: 'legacy', time: '14:00' })])
    expect(result.effective_time).toBe('15:00')
    expect(result.review.join(' ')).toContain('contradictorias')
  })
  it('la versión de invalidación tiene prioridad sobre el último evento', () => {
    expect(resolveReservationTiming({ ...r, time_version: 5, time_events: [event()] }, 'checkin').version).toBe(5)
  })
  it('rechaza prefijos inválidos y tareas de otras fechas', () => {
    expect(annotationTime('25:61|')).toBeNull()
    const reservation = { ...r, airbnb_code: null, guest_name: 'Huésped Sintético', guests: 2, notes: '', tasks: [
      { id: 't1', type: 'preparation', scheduled_for: '2026-01-01', notes: '09:00|', status: 'pending' },
      { id: 't2', type: 'cleaning', scheduled_for: '2026-01-02', notes: '09:00|', status: 'pending' },
    ] } as TurnoverReservation
    expect(checkinSlot(reservation, 'Sintético').time).toBe('15:00')
    expect(checkoutSlot(reservation, '2026-01-02', 'Sintético').time).toBe('11:00')
  })
})
