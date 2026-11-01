import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }))
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { dashboardDay } from '@/lib/dashboard-day'

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.setSystemTime(new Date('2026-11-01T23:59:59Z')) })
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('corte automático de Inicio', () => {
  it('refresca una vez a las 7 p. m., sin consultar periódicamente antes del corte', () => {
    render(<RefreshButton dayKey={dashboardDay().key} />)
    act(() => vi.advanceTimersByTime(999))
    expect(mocks.router.refresh).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(51))
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
  })
  it('al volver del segundo plano detecta un corte perdido y no adelanta dos días en medianoche', () => {
    const key = dashboardDay().key
    const { rerender } = render(<RefreshButton dayKey={key} />)
    vi.setSystemTime(new Date('2026-11-02T02:00:00Z'))
    fireEvent.focus(window)
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
    rerender(<RefreshButton dayKey={dashboardDay().key} />)
    act(() => vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 50))
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2)
  })
  it('espera si alguien está editando y luego permite cargar el día nuevo', () => {
    render(<><input aria-label="Nota Sintética" autoFocus /><RefreshButton dayKey={dashboardDay().key} /></>)
    act(() => vi.advanceTimersByTime(1050))
    expect(mocks.router.refresh).not.toHaveBeenCalled()
    act(() => screen.getByRole('textbox').blur())
    act(() => vi.advanceTimersByTime(1000))
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
  })
  it('no oculta un error al guardar la nota con el cambio de día', () => {
    const key = dashboardDay().key
    const { rerender } = render(<><div data-home-edit-error="true" /><RefreshButton dayKey={key} /></>)
    act(() => vi.advanceTimersByTime(1050))
    expect(mocks.router.refresh).not.toHaveBeenCalled()
    rerender(<><div data-home-edit-error="false" /><RefreshButton dayKey={key} /></>)
    act(() => vi.advanceTimersByTime(1000))
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
  })
  it('elimina el temporizador al salir de Inicio y conserva el botón manual', () => {
    const { unmount } = render(<RefreshButton dayKey={dashboardDay().key} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos' }))
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
    unmount()
    act(() => vi.advanceTimersByTime(2000))
    expect(mocks.router.refresh).toHaveBeenCalledOnce()
  })
})
