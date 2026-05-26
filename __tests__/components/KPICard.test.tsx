import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { KPICard } from '@/components/dashboard/KPICard'

describe('KPICard', () => {
  it('renders the label and value', () => {
    render(<KPICard label="Check-ins" value={3} color="#ff385c" subtitle="hoy" />)
    expect(screen.getByText('Check-ins')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('hoy')).toBeInTheDocument()
  })

  it('renders zero without crashing', () => {
    render(<KPICard label="Tareas" value={0} color="#f97316" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
