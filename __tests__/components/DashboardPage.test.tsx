import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb } from '../helpers/fake-db'
import { checkout } from '../helpers/checkout'
import { preparationArrival } from '../helpers/preparation'
const mocks = vi.hoisted(() => ({ db: vi.fn(), member: vi.fn(), tasks: vi.fn(), router: { refresh: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.db }))
vi.mock('@/lib/auth', () => ({ getCurrentMember: mocks.member }))
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router, redirect: () => { throw new Error('Redirección sintética') } }))
vi.mock('@/actions/team', () => ({ getTeamMembers: async () => [] }))
vi.mock('@/actions/tasks', () => ({ getTasks: mocks.tasks }))
vi.mock('@/actions/maintenance', () => ({ getMaintenance: async () => [] }))
vi.mock('@/actions/reservations', () => ({ getAcceptedChanges: async () => [] }))
vi.mock('@/actions/followups', () => ({ getTodayFollowups: async () => ({ charges: [], requests: [] }) }))
vi.mock('@/actions/supplies', () => ({ getLowStockAlerts: async () => [] }))
vi.mock('@/actions/purchases', () => ({ getPurchaseRequests: async () => [] }))
vi.mock('@/components/dashboard/CheckoutCard', () => ({ CheckoutCard: ({ co, planning }: { co: { guest_name: string }; planning: boolean }) =>
  <article>{co.guest_name} · {planning ? 'plan' : 'hoy'}</article> }))
vi.mock('@/components/dashboard/DashboardPrepCard', () => ({ DashboardPrepCard: ({ arrival }: { arrival: { guest_name: string } }) =>
  <article>{arrival.guest_name}</article> }))
vi.mock('@/components/tasks/TaskCard', () => ({ TaskCard: () => <article>Tarea Sintética</article> }))
import DashboardPage from '@/app/(app)/page'

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.member.mockResolvedValue({ id: 'synthetic-admin', name: 'Admin Sintético', role: 'admin' })
  const arrival = preparationArrival({ check_in: '2026-11-01', check_out: '2026-11-04', guest_name: 'Llegada Hoy Sintética' })
  const tomorrow = preparationArrival({ id: 'tomorrow-synthetic', check_in: '2026-11-02', check_out: '2026-11-05', guest_name: 'Llegada Mañana Sintética' })
  const co = checkout()
  const departure = { id: 'departure-synthetic', property_id: co.property_id, check_in: '2026-10-29', check_out: '2026-11-01',
    guest_name: 'Salida Hoy Sintética', status: 'confirmed', guests: 4, time_events: [], property: { name: 'Apartamento Sintético' },
    tasks: [{ ...co.cleaning.task, type: 'cleaning', scheduled_for: '2026-11-01' }] }
  mocks.db.mockResolvedValue(fakeDb({ reservations: [{ ...arrival }, { ...tomorrow },
    { ...tomorrow, id: 'tomorrow-second-synthetic', guest_name: 'Llegada Mañana Dos Sintética' },
    { ...tomorrow, id: 'future-synthetic', check_in: '2026-11-03', guest_name: 'Llegada Futuro Sintética' },
    { ...tomorrow, id: 'cancelled-synthetic', status: 'cancelled', guest_name: 'Cancelación Sintética' },
    departure, { ...departure, id: 'departure-tomorrow-synthetic', guest_name: 'Salida Mañana Sintética', check_out: '2026-11-02',
      tasks: [{ ...departure.tasks[0], scheduled_for: '2026-11-02' }] },
  ] }))
  mocks.tasks.mockResolvedValue([{ id: 'other-synthetic', type: 'other', scheduled_for: '2026-11-01', status: 'pending' }])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Inicio usa un único día colombiano para tarjetas e indicadores', () => {
  it.each([
    ['2026-11-01T23:59:59Z', '2026-11-01', 'hoy', 1, 2],
    ['2026-11-02T00:00:00Z', '2026-11-02', 'mañana', 2, 1],
    ['2026-11-02T05:00:00Z', '2026-11-02', 'hoy', 2, 1],
  ] as const)('%s: muestra %s, rótulos %s y contadores coherentes', async (instant, day, label, arrivals, pending) => {
    vi.setSystemTime(new Date(instant))
    render(await DashboardPage())
    expect(screen.getByText(`Preparación de ${label} (${arrivals})`)).toBeInTheDocument()
    expect(screen.getByText(`🚪 Salidas de ${label}`)).toBeInTheDocument()
    expect(screen.getByText('Llegadas').parentElement).toHaveTextContent(`${arrivals}${label}`)
    expect(screen.getByText('Pendientes').parentElement).toHaveTextContent(`${pending}para ${label}`)
    expect(screen.queryByText('Llegada Futuro Sintética')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancelación Sintética')).not.toBeInTheDocument()
    expect(screen.queryByText(/hoy y mañana/i)).not.toBeInTheDocument()
    expect(mocks.tasks).toHaveBeenCalledWith({ date: day, type: 'other' })
    if (label === 'mañana') {
      expect(screen.getByText(/Plan para mañana/)).toHaveTextContent('lunes 2 de noviembre')
      expect(screen.getByText('Salida Mañana Sintética · plan')).toBeInTheDocument()
      expect(screen.queryByText('Llegada Hoy Sintética')).not.toBeInTheDocument()
    } else {
      expect(screen.queryByText(/Plan para mañana/)).not.toBeInTheDocument()
      expect(screen.getByText(day === '2026-11-01' ? 'Salida Hoy Sintética · hoy' : 'Salida Mañana Sintética · hoy')).toBeInTheDocument()
    }
  })
  it.each(['cleaning', 'maintenance', 'anfitrion'])('el corte conserva el acceso del rol %s', async role => {
    mocks.member.mockResolvedValue({ id: 'synthetic-member', name: 'Persona Sintética', role })
    vi.setSystemTime(new Date('2026-11-02T00:00:00Z'))
    render(await DashboardPage())
    expect(screen.getByText('Preparación de mañana (2)')).toBeInTheDocument()
  })
  it('no consulta reservas sin sesión', async () => {
    mocks.member.mockResolvedValue(null)
    await expect(DashboardPage()).rejects.toThrow('Redirección sintética')
    expect(mocks.db).not.toHaveBeenCalled()
  })
})
