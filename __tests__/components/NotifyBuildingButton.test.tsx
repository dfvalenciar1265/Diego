import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), role: 'admin' as string | null }))
vi.mock('@/actions/building-notices', () => ({ getBuildingNotices: mocks.read, manageBuildingNotice: mocks.save }))
vi.mock('@/lib/user-context', () => ({ useUserRole: () => mocks.role }))
import { NotifyBuildingButton } from '@/components/dashboard/NotifyBuildingButton'
import { buildingIds as ids, buildingNotice, buildingRecipient, buildingView } from '../helpers/building-notices'
import type { BuildingNoticeView } from '@/lib/building-notices'

function response(view: BuildingNoticeView) { return { ok: true, status: 200, data: { date: '2026-11-08', arrivals: [view] } } }
async function open(view = buildingView()) {
  mocks.read.mockResolvedValue(response(view))
  render(<NotifyBuildingButton reservationId={ids.reservation} />)
  fireEvent.click(screen.getByRole('button', { name: /Aviso al edificio/ }))
  await screen.findByLabelText('Destinatario del edificio')
  fireEvent.change(screen.getByLabelText('Destinatario del edificio'), { target: { value: ids.recipient } })
}
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.role = 'admin' })

describe('aviso humano y verificable al edificio', () => {
  it.each(['cleaning','maintenance','anfitrion',null])('no muestra controles ni consulta para %s', role => {
    mocks.role = role
    render(<NotifyBuildingButton reservationId={ids.reservation} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('no elige automáticamente entre contactos ni acredita marcas anteriores', async () => {
    const view = buildingView({ recipients: [buildingRecipient(), buildingRecipient({ id: '10000000-0000-4000-8000-000000000008', address: 'otro-sintetico@example.test' })],
      legacy_marks: [{ task_id: 'tarea-sintetica', at: '2026-11-07T15:00:00Z' }] })
    mocks.read.mockResolvedValue(response(view))
    render(<NotifyBuildingButton reservationId={ids.reservation} />)
    fireEvent.click(screen.getByRole('button', { name: /Aviso al edificio/ }))
    expect(await screen.findByLabelText('Destinatario del edificio')).toHaveValue('')
    expect(screen.getByText(/Sin evidencia de envío asociada/)).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('abrir el borrador no registra envío y exige confirmación y evidencia para guardarlo', async () => {
    const view = buildingView(); view.notices = [buildingNotice(view)]
    await open(view)
    const link = screen.getByRole('link', { name: /Abrir borrador en correo/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('mailto:porter-sintetico@example.test'))
    // Evita abrir una aplicación externa durante la prueba.
    link.addEventListener('click', event => event.preventDefault())
    fireEvent.click(link)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByText('Preparado · contenido 1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Guardar registro' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Evidencia o referencia/), { target: { value: 'Referencia Sintética del mensaje' } })
    expect(screen.getByRole('button', { name: 'Guardar registro' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Confirmo que comprobé este resultado y su evidencia.'))
    mocks.save.mockResolvedValue({ ok: false, status: 409, error: 'El aviso cambió. Consulta el estado actual.' })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El aviso cambió')
    expect(mocks.save).toHaveBeenCalledWith('record', expect.objectContaining({ notice_id: ids.notice, expected_version: 1,
      action: 'sent', confirmed: true, evidence: 'Referencia Sintética del mensaje', occurred_at: expect.stringMatching(/-05:00$/) }))
    expect(screen.queryByText('Envío registrado · contenido 1')).not.toBeInTheDocument()
  })
  it('conserva la clave ante un fallo incierto y no pinta éxito optimista', async () => {
    const view = buildingView(); view.notices = [buildingNotice(view)]
    await open(view)
    fireEvent.change(screen.getByLabelText(/Evidencia o referencia/), { target: { value: 'Referencia Sintética conservada' } })
    fireEvent.click(screen.getByLabelText('Confirmo que comprobé este resultado y su evidencia.'))
    mocks.save.mockRejectedValue(new Error('Corte de conexión Sintético'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar registro' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[0]).toEqual(mocks.save.mock.calls[1])
    expect(screen.getByText('Preparado · contenido 1')).toBeVisible()
  })
  it.each(['uncertain','sent','delivered','received'] as const)('no ofrece reenviar un aviso %s', async status => {
    const view = buildingView(); view.notices = [buildingNotice(view, { status })]
    await open(view)
    expect(screen.queryByRole('link', { name: /Abrir borrador/ })).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('la verificación necesita evidencia y solo habilita preparar tras releer el estado guardado', async () => {
    await open(buildingView({ recipients: [buildingRecipient({ verified_at: null, verified_by: null, verification_evidence: null, version: 0 })] }))
    expect(screen.queryByRole('button', { name: 'Preparar borrador' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar destinatario' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Cómo verificaste el destinatario'), { target: { value: 'Verificación Sintética del contacto' } })
    mocks.save.mockResolvedValue({ ok: true, status: 200, data: buildingRecipient() })
    mocks.read.mockResolvedValue(response(buildingView()))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar destinatario' }))
    expect(await screen.findByRole('button', { name: 'Preparar borrador' })).toBeEnabled()
    expect(mocks.save).toHaveBeenCalledWith('verify_recipient', expect.objectContaining({ expected_version: 0, recipient_id: ids.recipient }))
  })
  it('expone el bloqueo si no hay destinatario y los fallos de lectura', async () => {
    mocks.read.mockResolvedValue(response(buildingView({ recipients: [] })))
    render(<NotifyBuildingButton reservationId={ids.reservation} />)
    fireEvent.click(screen.getByRole('button', { name: /Aviso al edificio/ }))
    expect(await screen.findByText('Falta configurar y verificar un destinatario de este apartamento.')).toBeVisible()
    mocks.read.mockResolvedValue({ ok: false, error: 'No se pudieron consultar los avisos.' })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron consultar')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('al volver al contenido anterior muestra su aviso registrado y exige revisar su vigencia', async () => {
    const view = buildingView()
    const old = buildingNotice(view, { status: 'sent', review_reason: 'Cambió la reserva. Revisa el aviso.' })
    const latest = buildingNotice(view, { id: '10000000-0000-4000-8000-000000000009', content_version: 2,
      snapshot: { ...old.snapshot, guests: 3 } })
    view.notices = [latest, old]
    await open(view)
    expect(screen.getByText('Envío registrado · contenido 1')).toBeVisible()
    expect(screen.getByText('Cambió la reserva. Revisa el aviso.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Preparar borrador' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Abrir borrador/ })).not.toBeInTheDocument()
  })
})
