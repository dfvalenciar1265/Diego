import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ review: vi.fn(), sync: vi.fn(), role: vi.fn(), refresh: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/actions/gmail', () => ({ reviewGmailIssue: mocks.review, syncGmail: mocks.sync }))
vi.mock('@/lib/user-context', () => ({ useUserRole: mocks.role }))
vi.mock('@/components/ui/feedback', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }))
import { GmailReconciliation } from '@/components/settings/GmailReconciliation'
import { GmailSyncButton } from '@/components/calendar/GmailSyncButton'
import { GmailSettingsClient } from '@/components/settings/GmailSettingsClient'
import type { SyncResult } from '@/lib/gmail-reconciliation/types'
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
  it('hace visibles las tareas repetidas conservadas para revisión', () => {
    const value=status()
    value.latest!.stats.duplicate_task_groups=4
    render(<GmailReconciliation status={value} />)
    expect(screen.getByText(/Tareas repetidas: 4 grupos requieren revisión/)).toHaveTextContent('Se conservan sus notas y estados')
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
    await waitFor(() => expect(screen.getByText('Por revisar')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Ver conciliación' })).toHaveAttribute('href', '/settings/gmail')
    expect(mocks.error).not.toHaveBeenCalled(); expect(mocks.warning).toHaveBeenCalled()
    expect(screen.queryByText('✓')).not.toBeInTheDocument(); expect(mocks.success).not.toHaveBeenCalled()
  })
  it.each([
    [{ ok: false, state: 'partial', scan_complete: false, error_code: 'source_incomplete' }, 'Por continuar', 'warning'],
    [{ ok: false, state: 'partial', scan_complete: true, error_code: null, pending_count: 108, duplicate_task_groups: 4 }, 'Por revisar', 'warning'],
    [{ ok: false, state: 'busy' }, 'En curso', 'warning'],
    [{ ok: false, state: 'failed', error_code: 'gmail_unavailable' }, 'Error', 'error'],
  ] as const)('el calendario comunica %s sin certificar éxito', async (result, label, tone) => {
    mocks.sync.mockResolvedValue(result)
    render(<GmailSyncButton />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(label))
    expect(mocks[tone]).toHaveBeenCalledOnce()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })
  it('un rechazo de la acción conserva la incertidumbre en rojo', async () => {
    mocks.sync.mockRejectedValue(new Error('Fallo sintético'))
    render(<GmailSyncButton />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Resultado incierto')))
    expect(mocks.warning).not.toHaveBeenCalled()
  })
  it('la configuración distingue paginación y no repite el aviso rojo de la captura', () => {
    render(<GmailReconciliation status={status()} />)
    expect(screen.getByText(/Último intento:/)).toHaveTextContent('Por continuar')
    expect(screen.queryByText(/El intento registró un error/)).not.toBeInTheDocument()
    expect(screen.getByText(/Lectura por partes:/)).toHaveClass('text-amber-800')
  })
  it('una lectura completa con conflictos conserva los pendientes visibles', () => {
    const value = status()
    value.latest!.scan_complete = true
    value.latest!.error_code = null
    value.latest!.stats.duplicate_task_groups = 4
    value.pendingCount = 108
    render(<GmailReconciliation status={value} />)
    expect(screen.getByText(/Último intento:/)).toHaveTextContent('Lectura completa, con revisiones pendientes')
    expect(screen.getByText(/Quedan 108 correos y 4 grupos/)).toHaveClass('text-amber-800')
    expect(screen.getByText('Pendientes de conciliación: 108')).toBeInTheDocument()
  })
  it.each([
    [{ ok: false, state: 'partial', scan_complete: false, error_code: 'source_incomplete' }, '#92400e', 'Lectura por partes:'],
    [{ ok: false, state: 'failed', error_code: 'gmail_unavailable' }, '#dc2626', 'No se completó la importación.'],
  ] satisfies [SyncResult, string, string][])('la acción en ajustes muestra el tono correcto para %s', async (result, color, message) => {
    mocks.sync.mockResolvedValue(result)
    render(<GmailSettingsClient {...status()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message))
    expect(screen.getByRole('status')).toHaveStyle({ color })
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
