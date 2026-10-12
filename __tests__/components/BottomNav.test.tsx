import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UserRoleProvider } from '@/lib/user-context'
import type { UserRole } from '@/lib/types'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import { BottomNav } from '@/components/layout/BottomNav'

function renderAs(role: UserRole, path = '/') {
  pathname = path
  return render(<UserRoleProvider role={role}><BottomNav /></UserRoleProvider>)
}

describe('BottomNav', () => {
  it('admin ve 4 destinos + «Más», y «Más» abre el resto con etiquetas completas', async () => {
    renderAs('admin')
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    expect(screen.getByText('Mant.')).toBeInTheDocument()
    expect(screen.queryByText('Tareas')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Más/ }))
    for (const label of ['Tareas', 'Apartamentos', 'Reportes', 'Personas', 'Gmail']) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })

  it('«Más» se marca activo si la ruta está dentro', () => {
    renderAs('admin', '/properties/abc')
    expect(screen.getByRole('button', { name: /Más/ })).toHaveAttribute('aria-current', 'page')
  })

  it('limpieza (5 destinos) ve todo sin «Más»', () => {
    renderAs('cleaning')
    expect(screen.getByText('Tareas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Más/ })).not.toBeInTheDocument()
  })
})
