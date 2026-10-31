import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/checkout-cleaning', () => ({ saveCheckoutCleaning: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
import { CheckoutCleaningControl } from '@/components/dashboard/CheckoutCleaningControl'
import { checkout, cleanerId, adminId, otherCleanerId } from '../helpers/checkout'
const people = [{ id: cleanerId, name: 'Ana Sintética' }]
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
describe('limpieza fácil en una salida', () => {
  it('administración elige quién limpia; no atribuye el trabajo a quien pulsa el botón', async () => {
    mocks.save.mockResolvedValue({ success: true })
    render(<CheckoutCleaningControl checkout={checkout()} role="admin" memberId={adminId} people={people} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar limpieza' }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmar inicio' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: '¿Quién va a limpiar?' }), { target: { value: cleanerId } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar inicio' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ action: 'start', assigned_to: cleanerId })))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(screen.getByText('○ Limpieza pendiente')).toBeVisible()
    expect(screen.queryByText('🧹 Limpieza en curso')).not.toBeInTheDocument()
  })
  it('limpieza inicia sobre sí misma sin desplegar la lista de personas', async () => {
    mocks.save.mockResolvedValue({ success: true })
    render(<CheckoutCleaningControl checkout={checkout()} role="cleaning" memberId={cleanerId} people={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar limpieza' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ assigned_to: cleanerId })))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
  it('permite terminar y conserva responsable; no pinta completada ante conflicto', async () => {
    const co = checkout(); Object.assign(co.cleaning.task!, { status: 'in_progress', assigned_to: cleanerId, assignee_name: 'Ana Sintética' })
    mocks.save.mockResolvedValue({ success: false, error: 'La limpieza cambió. Actualiza.' })
    render(<CheckoutCleaningControl checkout={co} role="admin" memberId={adminId} people={people} />)
    expect(screen.getByText('A cargo de Ana Sintética')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Terminar limpieza' }))
    expect(await screen.findByRole('status')).toHaveTextContent('La limpieza cambió')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ action: 'finish', assigned_to: cleanerId }))
    expect(screen.queryByText('✓ Limpieza terminada')).not.toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('un fallo de conexión deja el estado pendiente de comprobar', async () => {
    mocks.save.mockRejectedValue(new Error('Fallo sintético'))
    render(<CheckoutCleaningControl checkout={checkout()} role="cleaning" memberId={cleanerId} people={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar limpieza' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Resultado incierto')
    expect(screen.getByText('○ Limpieza pendiente')).toBeVisible()
  })
  it('no habilita a mantenimiento ni a otra persona asignada y no selecciona una tarea duplicada', () => {
    const co = checkout(); co.cleaning.task!.assigned_to = otherCleanerId
    const { rerender } = render(<CheckoutCleaningControl checkout={co} role="cleaning" memberId={cleanerId} people={[]} />)
    expect(screen.queryByRole('button', { name: 'Iniciar limpieza' })).not.toBeInTheDocument()
    rerender(<CheckoutCleaningControl checkout={checkout()} role="maintenance" memberId={cleanerId} people={[]} />)
    expect(screen.queryByRole('button', { name: 'Iniciar limpieza' })).not.toBeInTheDocument()
    co.cleaning.task = null; co.cleaning.review = 'Hay varias tareas de limpieza.'
    rerender(<CheckoutCleaningControl checkout={co} role="admin" memberId={adminId} people={people} />)
    expect(screen.getByRole('link', { name: 'Revisar en Limpieza' })).toHaveAttribute('href', '/cleaning')
    expect(screen.queryByRole('button', { name: 'Iniciar limpieza' })).not.toBeInTheDocument()
  })
})
