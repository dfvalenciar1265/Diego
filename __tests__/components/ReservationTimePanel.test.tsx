import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/reservation-times', () => ({ saveReservationTime: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
import { ReservationTimePanel } from '@/components/dashboard/ReservationTimePanel'
import { resolveReservationTiming } from '@/lib/reservation-times'
import { timingReservation as r, timeEvent as event } from '../helpers/timing'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
const timing = resolveReservationTiming({ ...r, time_events: [event()] }, 'checkin')
const entry = () => screen.getByText('Entrada desde las').parentElement!
const exit = () => screen.getByText('Salida hasta las').parentElement!

describe('presentación y edición de horarios', () => {
  it('la propia hora abre la edición y cerrar no guarda ningún cambio', () => {
    render(<ReservationTimePanel timing={resolveReservationTiming(r, 'checkout')} stay={r} canEdit />)
    const button = screen.getByRole('button', { name: /Editar hora de salida: 11:00 a. m./ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Ver o ajustar horario')).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.getByLabelText('Hora permitida por administración')).toHaveValue('11:00')
    fireEvent.change(screen.getByLabelText('Hora permitida por administración'), { target: { value: '12:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(exit()).toHaveTextContent('11:00 a. m.')
  })
  it.each([false, true])('muestra una sola hora operativa sin fuentes ni historial (edición %s)', canEdit => {
    render(<ReservationTimePanel timing={resolveReservationTiming(r, 'checkin')} stay={r} canEdit={canEdit} />)
    expect(entry()).toHaveTextContent('3:00 p. m.')
    expect(screen.queryByText(/Avisó llegada:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Fuente e historial/)).not.toBeInTheDocument()
    expect(screen.queryByText('Horario habitual: 15:00')).not.toBeInTheDocument()
    expect(screen.queryByText('Hora avisada por el huésped: Sin comunicar')).not.toBeInTheDocument()
  })

  it('distingue la hora avisada de la entrada permitida y mantiene el aviso visible para personal', () => {
    render(<ReservationTimePanel timing={timing} stay={r} />)
    expect(entry()).toHaveTextContent('3:00 p. m.')
    expect(screen.getByText(/Avisó llegada:/)).toHaveTextContent('9:00 a. m.')
    expect(screen.getByText(/Avisó que llega antes/)).toBeVisible()
    expect(screen.queryByText('Ver o ajustar horario')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar hora avisada', hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByText(/Fuente e historial/)).not.toBeInTheDocument()
  })

  it('una nota estándar no agrega detalles ni alarma operativa', () => {
    const legacy = resolveReservationTiming(r, 'checkin', { id: 'task-synthetic', notes: '15:00|' })
    render(<ReservationTimePanel timing={legacy} stay={r} />)
    expect(entry()).toHaveTextContent('3:00 p. m.')
    expect(screen.queryByText(/confirmar con administración/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Excepción heredada:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Fuente e historial/)).not.toBeInTheDocument()
  })

  it('mantiene visible la revisión de una excepción heredada que sí cambia la hora', () => {
    const legacy = resolveReservationTiming(r, 'checkin', { id: 'task-synthetic', notes: '13:00|' })
    render(<ReservationTimePanel timing={legacy} stay={r} />)
    expect(entry()).toHaveTextContent('1:00 p. m.')
    expect(screen.getByText('Horario especial autorizado')).toBeVisible()
    expect(screen.getByText(/confirmar con administración/)).toBeVisible()
  })

  it('una nota estándar no oculta la contradicción entre correo y ajuste manual', () => {
    const events = [
      event({ id: 'manual', time: '16:00', version: 3 }),
      event({ id: 'email', source: 'gmail', time: '17:00', version: 2 }),
      event({ id: 'legacy', source: 'legacy', kind: 'authorization', time: '15:00', version: 1 }),
    ]
    render(<ReservationTimePanel timing={resolveReservationTiming({ ...r, time_events: events }, 'checkin')} stay={r} />)
    expect(entry()).toHaveTextContent('3:00 p. m.')
    expect(screen.getByText(/Avisó llegada:/)).toHaveTextContent('4:00 p. m.')
    expect(screen.getByText(/La hora avisada del correo contradice el ajuste manual/)).toBeVisible()
    expect(screen.queryByText(/Excepción heredada:/)).not.toBeInTheDocument()
  })

  it('las horas de una estancia modificada quedan en revisión y no sustituyen el estándar', () => {
    const changed = { ...r, check_in: '2027-02-11', time_events: [event({ kind: 'authorization', time: '13:00' })] }
    render(<ReservationTimePanel timing={resolveReservationTiming(changed, 'checkin')} stay={changed} />)
    expect(entry()).toHaveTextContent('3:00 p. m.')
    expect(screen.getAllByText(/estancia modificada o cancelada/).some(node => !node.closest('details'))).toBe(true)
    expect(screen.queryByText('Horario especial autorizado')).not.toBeInTheDocument()
  })

  it('una salida avisada más tarde no cambia el límite de salida', () => {
    const checkout = resolveReservationTiming({ ...r, time_events: [event({ direction: 'checkout', time: '13:00' })] }, 'checkout')
    render(<ReservationTimePanel timing={checkout} stay={r} />)
    expect(exit()).toHaveTextContent('11:00 a. m.')
    expect(screen.getByText(/Avisó salida:/)).toHaveTextContent('1:00 p. m.')
    expect(screen.getByText(/Falta autorizar ese horario/)).toBeVisible()
    expect(screen.queryByText(/Avisó llegada:/)).not.toBeInTheDocument()
  })

  it.each([
    ['00:00', '12:00 a. m.'], ['12:00', '12:00 p. m.'], ['23:30', '11:30 p. m.'],
  ])('muestra sin ambigüedad la hora autorizada %s', (time, label) => {
    const authorized = resolveReservationTiming({ ...r, time_events: [event({ kind: 'authorization', time })] }, 'checkin')
    render(<ReservationTimePanel timing={authorized} stay={r} />)
    expect(entry()).toHaveTextContent(label)
    expect(screen.getByText('Horario especial autorizado')).toBeVisible()
  })

  it('guardar la hora avisada manda kind=estimate y espera la confirmación del servidor', async () => {
    mocks.save.mockResolvedValue({ success: true })
    render(<ReservationTimePanel timing={timing} stay={r} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Editar hora de entrada/ }))
    fireEvent.click(screen.getByText('Hora avisada por el huésped'))
    fireEvent.change(screen.getByLabelText('Hora que avisó el huésped'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar hora avisada' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'estimate', time: '10:00', expected_version: 1, stay_check_in: r.check_in, stay_check_out: r.check_out,
    })))
    expect(entry()).toHaveTextContent('3:00 p. m.')
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('un error conserva la clave para el reintento y muestra el conflicto', async () => {
    mocks.save.mockResolvedValue({ success: false, error: 'El horario cambió. Actualiza.' })
    render(<ReservationTimePanel timing={timing} stay={r} canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Editar hora de entrada/ }))
    fireEvent.change(screen.getByLabelText('Hora permitida por administración'), { target: { value: '13:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar hora permitida' }))
    await screen.findByText(/El horario cambió/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar hora permitida' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Guardar hora permitida' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[0][0].request_key).toBe(mocks.save.mock.calls[1][0].request_key)
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ kind: 'authorization', expected_version: 1 })
    expect(entry()).toHaveTextContent('3:00 p. m.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
