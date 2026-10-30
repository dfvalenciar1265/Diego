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
describe('presentación y edición de horarios', () => {
  it('distingue estándar, ETA, excepción y advertencia sin controles para personal', () => {
    render(<ReservationTimePanel timing={timing} stay={r} />)
    expect(screen.getByText('Hora permitida: 15:00')).toBeInTheDocument()
    expect(screen.getByText(/ETA del huésped:/)).toHaveTextContent('09:00')
    expect(screen.getByText(/Excepción autorizada:/)).toHaveTextContent('Ninguna')
    expect(screen.getByText(/no autoriza check-in temprano/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar ETA' })).not.toBeInTheDocument()
    expect(screen.getByText(/29\/10\/26/)).toBeInTheDocument() // 03:30 UTC aún es el 29 en Colombia.
  })
  it('guardar ETA manda kind=estimate; no adelanta optimistamente la hora permitida', async () => {
    mocks.save.mockResolvedValue({ success: true })
    render(<ReservationTimePanel timing={timing} stay={r} canEdit />)
    fireEvent.click(screen.getByText('Registrar ETA o autorizar excepción'))
    fireEvent.change(screen.getByLabelText('ETA comunicada'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ETA' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'estimate', time: '10:00', expected_version: 1, stay_check_in: r.check_in })))
    expect(screen.getByText('Hora permitida: 15:00')).toBeInTheDocument()
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })
  it('un error conserva la clave para el reintento y muestra el conflicto', async () => {
    mocks.save.mockResolvedValue({ success: false, error: 'El horario cambió. Actualiza.' })
    render(<ReservationTimePanel timing={timing} stay={r} canEdit />)
    fireEvent.click(screen.getByText('Registrar ETA o autorizar excepción'))
    fireEvent.change(screen.getByLabelText('Hora autorizada'), { target: { value: '13:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar excepción' }))
    await screen.findByText(/El horario cambió/)
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar excepción' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[0][0].request_key).toBe(mocks.save.mock.calls[1][0].request_key)
    expect(screen.getByText('Hora permitida: 15:00')).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
