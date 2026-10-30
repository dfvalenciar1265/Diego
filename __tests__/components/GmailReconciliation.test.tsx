import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ review: vi.fn(), sync: vi.fn(), role: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/actions/gmail', () => ({ reviewGmailIssue: mocks.review, syncGmail: mocks.sync }))
vi.mock('@/lib/user-context', () => ({ useUserRole: mocks.role }))
vi.mock('@/components/ui/feedback', () => ({ toast: { success: mocks.success, error: mocks.error } }))
import { GmailReconciliation } from '@/components/settings/GmailReconciliation'
import { GmailSyncButton } from '@/components/calendar/GmailSyncButton'
import type { GmailStatus } from '@/lib/gmail-reconciliation/status'
const status = (): GmailStatus => ({ connected: true, available: true, delayed: true, interrupted: false, intervalMinutes: 15, pendingCount: 1,
  latest: { id: 'synthetic-run', status: 'partial', started_at: '2026-10-30T04:30:00Z', finished_at: '2026-10-30T04:31:00Z', lease_until: '2026-10-30T04:40:00Z',
    scope_from: '2026-10-29T05:00:00Z', scope_to: '2026-10-30T04:30:00Z', scan_complete: false, stats: {}, error_code: 'source_incomplete' },
  lastRead: null, issues: [{ id: 'synthetic-issue', kind: 'cancellation', status: 'conflict', code: 'HMSYNC0001', source_at: '2026-10-30T04:30:00Z', reason: 'cancellation_without_reservation', version: 3, reservation_id: null }],
})
beforeEach(() => { vi.clearAllMocks(); mocks.role.mockReturnValue('admin') })
describe('estado visible de la importación', () => {
  it('distingue demora, conflicto y cancelación explícita; muestra el día de Bogotá', () => {
    render(<GmailReconciliation status={status()} />)
    expect(screen.getByText(/Demora:.*no significa cancelación/)).toBeInTheDocument()
    expect(screen.getByText(/Queda correo por leer/)).toBeInTheDocument()
    expect(screen.getByText('Cancelación explícita · HMSYNC0001')).toBeInTheDocument()
    expect(screen.getByText(/Correo:.*29.*2026/)).toBeInTheDocument()
    expect(screen.getByText('Pendientes de conciliación: 1')).toBeInTheDocument()
  })
  it('la ausencia de una migración no muestra cero pendientes ni éxito', () => {
    render(<GmailReconciliation status={{ ...status(), available: false }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('no se puede certificar')
    expect(screen.queryByText('Pendientes de conciliación: 0')).not.toBeInTheDocument()
  })
  it('si cambió la versión, conserva la nota y no muestra revisión confirmada', async () => {
    mocks.review.mockResolvedValue({ success: false, error: 'El pendiente cambió. Actualiza.' })
    render(<GmailReconciliation status={status()} />)
    fireEvent.change(screen.getByLabelText('Constancia de revisión'), { target: { value: 'Revisión sintética' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar revisión sin cambiar la reserva' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('El pendiente cambió'))
    expect(mocks.review).toHaveBeenCalledWith('synthetic-issue', 3, 'Revisión sintética')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('oculta la importación al personal de limpieza', () => {
    mocks.role.mockReturnValue('cleaning'); render(<GmailSyncButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('una lectura parcial con cero nuevas no produce la marca verde de éxito', async () => {
    mocks.sync.mockResolvedValue({ ok: false, state: 'partial', new_count: 0, error: 'Hay pendientes de conciliación.' })
    render(<GmailSyncButton />); fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('Hay pendientes de conciliación.')).toBeInTheDocument())
    expect(screen.queryByText('✓')).not.toBeInTheDocument(); expect(mocks.success).not.toHaveBeenCalled()
  })
})
