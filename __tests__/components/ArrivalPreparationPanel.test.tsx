import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/preparation', () => ({ saveArrivalPreparation: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
import { ArrivalPreparationPanel } from '@/components/dashboard/ArrivalPreparationPanel'
import { DashboardPrepCard } from '@/components/dashboard/DashboardPrepCard'
vi.mock('@/actions/tasks', () => ({ updateTaskNotes: vi.fn() }))
vi.mock('@/actions/reservation-times', () => ({ saveReservationTime: vi.fn() }))
vi.mock('@/components/dashboard/NotifyBuildingButton', () => ({ NotifyBuildingButton: () => null }))
import { preparationArrival, preparationState, preparationView } from '../helpers/preparation'

const r = preparationArrival()
const stamp = '2026-10-30T03:30:00Z'
const checked = preparationState({ version: 2, cleaned_at: stamp, cleaned_name: 'Ana Sintética', checked_at: stamp, checked_name: 'Revisor Sintético' })
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('tres etapas en la llegada', () => {
  it('limpieza no puede confirmar listo y la revisión espera la limpieza', () => {
    render(<ArrivalPreparationPanel reservation={r} preparation={preparationView()} role="cleaning" />)
    expect(screen.getByRole('button', { name: 'Confirmar limpieza' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Confirmar revisión' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Confirmar listo' })).not.toBeInTheDocument()
    expect(screen.getByText(/Administración o anfitrión/)).toBeVisible()
  })
  it('mantenimiento puede revisar después de limpiar pero no certificar limpieza ni listo', () => {
    render(<ArrivalPreparationPanel reservation={r} preparation={preparationView({ state: preparationState({ cleaned_at: stamp, version: 1 }) })} role="maintenance" />)
    expect(screen.getByRole('button', { name: 'Confirmar revisión' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Confirmar limpieza' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar listo' })).not.toBeInTheDocument()
  })
  it('una incidencia urgente y una solicitud pendiente quedan junto a la llegada y bloquean listo', () => {
    const view = preparationView({ state: checked, blockers: ['Hay incidencias urgentes abiertas.'],
      issues: [{ id: 'urgent', property_id: r.property_id, title: 'Fuga Sintética', priority: 'urgent', status: 'open' }],
      requests: [{ id: 'crib', reservation_id: r.id, description: 'Cuna Sintética', status: 'notified', review_reason: null }] })
    render(<ArrivalPreparationPanel reservation={r} preparation={view} role="admin" />)
    expect(screen.getByText(/Fuga Sintética/)).toBeVisible()
    expect(screen.getByText(/Cuna Sintética/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ver en Mantenimiento' })).toHaveAttribute('href', '/maintenance')
    expect(screen.getByRole('button', { name: 'Confirmar listo' })).toBeDisabled()
  })
  it('una lectura fallida no muestra listo aunque exista una confirmación anterior', () => {
    render(<ArrivalPreparationPanel reservation={r} preparation={preparationView({ available: false, can_confirm: false,
      error: 'No se pudo comprobar la preparación.', state: { ...checked, ready_at: stamp }, blockers: [] })} role="admin" />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar')
    expect(screen.queryByText('✓ Preparación confirmada')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar listo' })).toBeDisabled()
  })
  it('guardar usa versión y estancia sin pintar la confirmación antes de refrescar', async () => {
    mocks.save.mockResolvedValue({ success: true })
    render(<ArrivalPreparationPanel reservation={r} preparation={preparationView()} role="cleaning" />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar limpieza' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      reservation_id: r.id, step: 'cleaning', confirmed: true, expected_version: 0,
      stay_check_in: r.check_in, stay_check_out: r.check_out,
    })))
    expect(screen.queryByText('✓ Limpieza terminada')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })
  it('un conflicto conserva la clave y no reintenta por su cuenta', async () => {
    mocks.save.mockResolvedValue({ success: false, conflict: true, error: 'La preparación cambió.' })
    render(<ArrivalPreparationPanel reservation={r} preparation={preparationView()} role="admin" />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar limpieza' }))
    await screen.findByText(/La preparación cambió/)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar limpieza' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar limpieza' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[0][0].request_key).toBe(mocks.save.mock.calls[1][0].request_key)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('reabrir exige motivo e historial conserva autor, fuente y fecha colombiana', async () => {
    mocks.save.mockResolvedValue({ success: true })
    const state = { ...checked, ready_at: stamp, ready_name: 'Admin Sintético', version: 3 }
    render(<ArrivalPreparationPanel reservation={r} preparation={preparationView({ state, blockers: [], history: [{
      id: 'event-synthetic', version: 3, action: 'ready:confirmed', reason: null, author: 'Admin Sintético', source: 'app', at: stamp,
    }] })} role="admin" />)
    expect(screen.getByText('✓ Preparación confirmada')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir Limpieza terminada' }))
    expect(screen.getByRole('button', { name: 'Confirmar reapertura' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo para reabrir: Limpieza terminada'), { target: { value: 'Se ensució de nuevo Sintético' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reapertura' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ step: 'cleaning', confirmed: false,
      expected_version: 3, reason: 'Se ensució de nuevo Sintético' })))
    fireEvent.click(screen.getByText('Quién confirmó e historial reciente'))
    expect(screen.getAllByText(/29\/10\/26/).every(node => node.closest('details')?.open)).toBe(true)
    expect(screen.getByText(/#3 · Admin Sintético · AirAdmin/)).toBeVisible()
  })
  it('las tareas duplicadas conservan sus notas y no habilitan elegir o sobrescribir una copia', () => {
    const duplicate = { ...r.tasks[0], id: 'duplicate-synthetic', notes: 'Otra indicación Sintética', status: 'done' }
    render(<DashboardPrepCard arrival={{ ...r, tasks: [r.tasks[0], duplicate] }} preparation={preparationView()} role="admin" />)
    expect(screen.getByText(/Hay varias tareas de preparación/)).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Nota para el equipo' })).not.toBeInTheDocument()
    expect(screen.queryByText('✓ Preparación confirmada')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Ver notas de las tareas (2)'))
    expect(screen.getByText(/Otra indicación Sintética/)).toBeVisible()
    expect(screen.getByText(/Dejar dos toallas adicionales/)).toBeVisible()
  })
  it('una llegada sin tarea sigue visible y pendiente, sin crear tareas para probar', () => {
    render(<DashboardPrepCard arrival={{ ...r, tasks: [] }} preparation={preparationView()} role="admin" />)
    expect(screen.getByText('2 huéspedes')).toBeVisible()
    expect(screen.getByText(/Falta la tarea de preparación/)).toBeVisible()
    expect(screen.queryByText('✓ Preparación confirmada')).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
