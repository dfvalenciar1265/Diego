import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PreparationSummary } from '@/components/dashboard/PreparationSummary'
import { preparationState, preparationView } from '../helpers/preparation'

afterEach(cleanup)
const stamp = '2026-11-12T10:00:00-05:00'
describe('resumen operativo de la próxima llegada', () => {
  it('muestra siguiente paso sin atribuir una persona ni confirmar trabajo', () => {
    render(<PreparationSummary preparation={preparationView()} />)
    expect(screen.getByText('Preparación pendiente')).toBeVisible()
    expect(screen.getByText(/Próximo paso: Confirmar la limpieza/)).toBeVisible()
    expect(screen.getByText(/La asignación individual se consulta en Tareas/)).toBeVisible()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tasks')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('avanza a revisión solo con limpieza explícita y sigue sin afirmar listo', () => {
    render(<PreparationSummary preparation={preparationView({ state: preparationState({ cleaned_at: stamp }) })} />)
    expect(screen.getByText('✓ Limpieza: confirmado')).toBeVisible()
    expect(screen.getByText('○ Revisión: pendiente')).toBeVisible()
    expect(screen.getByText(/Próximo paso: Revisar el funcionamiento/)).toBeVisible()
    expect(screen.queryByText('Listo para recibir · confirmado')).not.toBeInTheDocument()
  })
  it('la incidencia urgente tiene prioridad y dirige a mantenimiento', () => {
    render(<PreparationSummary preparation={preparationView({ issues: [{ id: 'issue-synthetic', property_id: 'property-synthetic',
      title: 'Aire Sintético', priority: 'urgent', status: 'open' }] })} />)
    expect(screen.getByText(/Próximo paso: Resolver y verificar la incidencia urgente/)).toBeVisible()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/maintenance')
  })
  it('una solicitud pendiente impide sugerir que ya está preparado', () => {
    render(<PreparationSummary preparation={preparationView({ state: preparationState({ cleaned_at: stamp, checked_at: stamp }),
      requests: [{ id: 'request-synthetic', reservation_id: 'stay-synthetic', description: 'Cuna Sintética', status: 'notified', review_reason: null }] })} />)
    expect(screen.getByText(/Próximo paso: Revisar las solicitudes especiales/)).toBeVisible()
  })
  it('muestra quién confirmó listo pero no confunde ese hecho con asignación', () => {
    render(<PreparationSummary preparation={preparationView({ blockers: [], state: preparationState({
      cleaned_at: stamp, checked_at: stamp, ready_at: stamp, ready_name: 'Administración Sintética' }) })} />)
    expect(screen.getByText('Listo para recibir · confirmado')).toBeVisible()
    expect(screen.getByText(/Confirmó: Administración Sintética/)).toBeVisible()
    expect(screen.queryByText(/Próximo paso/)).not.toBeInTheDocument()
  })
  it('un error de lectura oculta confirmaciones anteriores y exige comprobar datos', () => {
    render(<PreparationSummary preparation={preparationView({ available: false, can_confirm: false, blockers: [],
      state: preparationState({ cleaned_at: stamp, checked_at: stamp, ready_at: stamp }) })} />)
    expect(screen.getByText('Preparación sin comprobar')).toBeVisible()
    expect(screen.getByText(/Próximo paso: Comprobar los datos/)).toBeVisible()
    expect(screen.queryByText('Listo para recibir · confirmado')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
  it('no convierte una confirmación antigua con bloqueos en listo', () => {
    render(<PreparationSummary preparation={preparationView({ state: preparationState({ ready_at: stamp, review_reason: 'Cambió la estancia Sintética' }) })} />)
    expect(screen.queryByText('Listo para recibir · confirmado')).not.toBeInTheDocument()
    expect(screen.getByText(/Próximo paso: Revisar el cambio/)).toBeVisible()
    expect(screen.getByText('Cambió la estancia Sintética')).toBeVisible()
  })
})
