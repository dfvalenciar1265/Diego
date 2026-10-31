import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ notes: vi.fn(), save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tasks', () => ({ updateTaskNotes: mocks.notes }))
vi.mock('@/actions/preparation', () => ({ saveArrivalPreparation: mocks.save }))
vi.mock('@/actions/reservation-times', () => ({ saveReservationTime: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/components/dashboard/NotifyBuildingButton', () => ({ NotifyBuildingButton: () => null }))
import { DashboardPrepCard } from '@/components/dashboard/DashboardPrepCard'
import { preparationArrival, preparationView } from '../helpers/preparation'

const arrival = preparationArrival()
const view = preparationView()
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('preparación compacta para el equipo', () => {
  it('refrescar no duplica la hora ni vuelve a mostrar las confirmaciones retiradas', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { rerender } = render(<DashboardPrepCard arrival={arrival} preparation={view} role="admin" />)
      rerender(<DashboardPrepCard arrival={{ ...arrival, time_version: 1 }} preparation={{ ...view, state: null }} role="admin" />)
      expect(screen.getAllByRole('button', { name: /Editar hora de entrada/ })).toHaveLength(1)
      expect(screen.queryByRole('button', { name: 'Confirmar limpieza' })).not.toBeInTheDocument()
      expect(consoleError).not.toHaveBeenCalled()
    } finally { consoleError.mockRestore() }
  })
  it.each(['admin', 'anfitrion', 'cleaning', 'maintenance'] as const)('retira el bloque completo para %s y conserva incidencias y solicitudes', role => {
    render(<DashboardPrepCard arrival={arrival} preparation={preparationView({
      issues: [{ id: 'synthetic-issue', property_id: arrival.property_id, title: 'Fuga Sintética', priority: 'urgent', status: 'open' }],
      requests: [{ id: 'synthetic-crib', reservation_id: arrival.id, description: 'Cuna Sintética', status: 'notified', review_reason: null }],
    })} role={role} />)
    for (const text of ['Limpieza terminada', 'Revisión de funcionamiento', 'Listo para recibir',
      'Quién confirmó e historial reciente', 'Falta confirmar la limpieza para esta llegada.']) {
      expect(screen.queryByText(text, { exact: false })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Confirmar (limpieza|revisión|listo)/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Incidencias en este apartamento/)).toBeVisible()
    expect(screen.getByText(/Fuga Sintética/)).toBeVisible()
    expect(screen.getByText(/Cuna Sintética/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ver en Mantenimiento' })).toHaveAttribute('href', '/maintenance')
    expect(screen.getByRole('textbox', { name: 'Nota para el equipo' })).toBeVisible()
    expect(screen.getByText('2 huéspedes')).toBeVisible()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('mantiene visible un fallo al comprobar incidencias sin habilitar confirmaciones', () => {
    render(<DashboardPrepCard arrival={arrival} preparation={preparationView({ available: false, error: 'No se pudieron comprobar las incidencias.' })} role="admin" />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron comprobar las incidencias.')
    expect(screen.queryByRole('button', { name: /Confirmar (limpieza|revisión|listo)/ })).not.toBeInTheDocument()
  })
  it('muestra llegada legible y conserva la nota; editarla no autoriza una hora', async () => {
    mocks.notes.mockResolvedValue({ success: true })
    render(<DashboardPrepCard arrival={arrival} preparation={view} role="cleaning" />)
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
    await waitFor(() => expect(mocks.notes).toHaveBeenCalledWith(arrival.tasks[0].id, 'Dejar tres toallas adicionales', { noteOnly: true }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByText('3:00 p. m.')).toBeVisible()
  })

  it('conserva la indicación escrita y avisa si no se pudo guardar', async () => {
    mocks.notes.mockRejectedValue(new Error('fallo sintético'))
    render(<DashboardPrepCard arrival={arrival} preparation={view} role="cleaning" />)
    const note = screen.getByRole('textbox', { name: 'Nota para el equipo' })
    fireEvent.change(note, { target: { value: 'Indicación Sintética' } })
    fireEvent.blur(note)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó la nota. Revisa tu conexión.')
    expect(note).toHaveValue('Indicación Sintética')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
