import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ notes: vi.fn(), save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tasks', () => ({ updateTaskNotes: mocks.notes }))
vi.mock('@/actions/reservation-times', () => ({ saveReservationTime: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/components/dashboard/NotifyBuildingButton', () => ({ NotifyBuildingButton: () => null }))
import { DashboardPrepCard, type PrepTask } from '@/components/dashboard/DashboardPrepCard'
import { timingReservation as r } from '../helpers/timing'

const task: PrepTask = {
  id: 'prep-synthetic', property_id: r.property_id, reservation_id: r.id, type: 'preparation',
  assigned_to: null, scheduled_for: r.check_in, status: 'pending', notes: '15:00|Dejar dos toallas adicionales',
  photo_url: null, completed_at: null, cost: null, building_notified_at: null, created_at: '2026-10-30T15:00:00Z',
  property: { name: 'Apartamento Sintético 1214' },
  reservation: { ...r, status: 'confirmed', time_events: [], notes: null, guest_name: 'Huésped Sintético', guests: 2 },
}
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('preparación compacta para el equipo', () => {
  it('muestra llegada legible y conserva la nota; editarla no autoriza una hora', async () => {
    mocks.notes.mockResolvedValue({ success: true })
    render(<DashboardPrepCard task={task} />)
    expect(screen.getByText('🛏️ Apartamento Sintético 1214')).toBeVisible()
    expect(screen.getByText(/Huésped Sintético/)).toHaveTextContent('Huésped Sintético · 2 huéspedes')
    expect(screen.getByText('2 huéspedes')).toBeVisible()
    expect(screen.getByText(/Llega el 10 de?\s?feb|Llega el 10 feb/)).toBeVisible()
    expect(screen.getByText('3:00 p. m.')).toBeVisible()
    const note = screen.getByRole('textbox', { name: 'Nota para el equipo' })
    expect(note).toHaveValue('Dejar dos toallas adicionales')
    expect(mocks.notes).not.toHaveBeenCalled()
    fireEvent.change(note, { target: { value: 'Dejar tres toallas adicionales' } })
    fireEvent.blur(note)
    await waitFor(() => expect(mocks.notes).toHaveBeenCalledWith(task.id, 'Dejar tres toallas adicionales', { noteOnly: true }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByText('3:00 p. m.')).toBeVisible()
  })

  it('conserva la indicación escrita y avisa si no se pudo guardar', async () => {
    mocks.notes.mockRejectedValue(new Error('fallo sintético'))
    render(<DashboardPrepCard task={task} />)
    const note = screen.getByRole('textbox', { name: 'Nota para el equipo' })
    fireEvent.change(note, { target: { value: 'Indicación Sintética' } })
    fireEvent.blur(note)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó la nota. Revisa tu conexión.')
    expect(note).toHaveValue('Indicación Sintética')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
