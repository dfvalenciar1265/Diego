import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PendingMaintenance, type OpenMaintenance } from '@/components/dashboard/PendingMaintenance'
afterEach(cleanup)
describe('mantenimiento plegable', () => {
  it('muestra cantidad y urgencias cerrado; despliega los pendientes al tocar el título', () => {
    const issues = [{ id: 'synthetic', title: 'Fuga Sintética', priority: 'urgent', status: 'open', property: { name: 'Apartamento Sintético' } }] as OpenMaintenance[]
    render(<PendingMaintenance issues={issues} />)
    expect(screen.getByText('1 urgente')).toBeVisible()
    expect(screen.getByText('Fuga Sintética')).not.toBeVisible()
    fireEvent.click(screen.getByText(/Mantenimiento pendiente \(1\)/))
    expect(screen.getByText('Fuga Sintética')).toBeVisible()
    expect(screen.getByRole('link', { name: /Ver en Mantenimiento/ })).toHaveAttribute('href', '/maintenance')
    fireEvent.click(screen.getByText(/Mantenimiento pendiente \(1\)/))
    expect(screen.getByText('Fuga Sintética')).not.toBeVisible()
  })
})
