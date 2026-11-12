import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  fireEvent.click(screen.getByText('Registrar resultado o revisar destinatarios'))
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
    const link = screen.getByRole('link', { name: /Correo · porter-sintetico/ })
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
    expect(screen.queryByRole('link', { name: /Correo ·|WhatsApp ·/ })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('link', { name: /Correo ·|WhatsApp ·/ })).not.toBeInTheDocument()
  })
})

describe('botón compacto con estado acreditado', () => {
  it('carga envío del asistente y muestra verde con hora sin abrir historial', async () => {
    const view = buildingView()
    view.notices = [buildingNotice(view, { status: 'sent', sent_at: '2026-11-08T15:30:00Z' })]
    mocks.read.mockResolvedValue(response(view))
    render(<NotifyBuildingButton reservationId={ids.reservation} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aviso al edificio' })).toHaveTextContent(/Avisado/))
    expect(screen.getByRole('button', { name: 'Aviso al edificio' })).toHaveClass('bg-green-100')
    expect(screen.getByRole('button', { name: 'Aviso al edificio' })).toHaveTextContent(/10:30/)
    fireEvent.click(screen.getByRole('button', { name: 'Aviso al edificio' }))
    expect(screen.queryByText(/Historial y evidencia/)).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each(['prepared','uncertain'] as const)('mantiene gris el estado %s', async status => {
    const view = buildingView()
    view.notices = [buildingNotice(view, { status })]
    mocks.read.mockResolvedValue(response(view))
    render(<NotifyBuildingButton reservationId={ids.reservation} />)
    await waitFor(() => expect(mocks.read).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Aviso al edificio' })).toHaveClass('bg-slate-100')
    expect(screen.queryByText(/Avisado ·/)).not.toBeInTheDocument()
  })
  it('no acredita un aviso con cambios pendientes aunque tenga fecha', async () => {
    const view = buildingView()
    view.notices = [buildingNotice(view, { status:'sent', sent_at:'2026-11-08T15:30:00Z', review_reason:'Cambió la reserva' })]
    mocks.read.mockResolvedValue(response(view))
    render(<NotifyBuildingButton reservationId={ids.reservation} />)
    await waitFor(() => expect(mocks.read).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Aviso al edificio' })).toHaveClass('bg-slate-100')
  })
})


describe('aislamiento y carreras de avisos', () => {
  const sentView = () => { const view=buildingView();view.notices=[buildingNotice(view,{status:'sent',sent_at:'2026-11-08T15:30:00Z'})];return view }
  it('al cambiar reserva descarta verde, contacto y borrador anteriores inmediatamente', async () => {
    mocks.read.mockResolvedValue(response(sentView()))
    const ui=render(<NotifyBuildingButton reservationId={ids.reservation}/>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'Aviso al edificio'})).toHaveClass('bg-green-100'))
    mocks.read.mockResolvedValue({ok:false,error:'Sin acceso a nueva reserva'})
    ui.rerender(<NotifyBuildingButton reservationId="10000000-0000-4000-8000-000000000099"/>)
    expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
    expect(screen.queryByText(/porter-sintetico@example.test/)).not.toBeInTheDocument()
    await act(async()=>{})
    expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
  })
  it('fallo al actualizar quita evidencia visual y no deja abrir borrador previo', async () => {
    mocks.read.mockResolvedValue(response(sentView()))
    render(<NotifyBuildingButton reservationId={ids.reservation}/>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'Aviso al edificio'})).toHaveClass('bg-green-100'))
    mocks.read.mockRejectedValue(new Error('Fallo sintético'))
    fireEvent.click(screen.getByRole('button',{name:'Aviso al edificio'}))
    expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
    await screen.findByRole('alert')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
  })
  it('lectura antigua tardía no reemplaza respuesta reciente ni restaura verde', async () => {
    let finish!: (value:ReturnType<typeof response>)=>void
    mocks.read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve})).mockResolvedValue(response(buildingView()))
    render(<NotifyBuildingButton reservationId={ids.reservation}/>)
    await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button',{name:'Aviso al edificio'}))
    await screen.findByLabelText('Destinatario del edificio')
    await act(async()=>{finish(response(sentView()))})
    expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
  })
  it('no muestra datos devueltos para otra reserva', async () => {
    mocks.read.mockResolvedValue(response(sentView()))
    render(<NotifyBuildingButton reservationId="10000000-0000-4000-8000-000000000099"/>)
    fireEvent.click(screen.getByRole('button',{name:'Aviso al edificio'}))
    await screen.findByRole('alert')
    expect(screen.queryByLabelText('Destinatario del edificio')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
  })
})

it.each([['vigente',null,'2026-11-08T07:30:00-05:00',true],['invalidada','2026-11-09T00:00:00Z','2026-11-08T07:30:00-05:00',false],['fecha inválida',null,'invalid-synthetic',false]] as const)('observación histórica %s no acredita más de lo comprobado',async(_label,invalidated_at,occurred_at,green)=>{
 const view=buildingView();const notice=buildingNotice(view)
 view.observations=[{id:ids.notice,reservation_id:ids.reservation,recipient_id:ids.recipient,snapshot:notice.snapshot,status:'delivered',occurred_at,recorded_at:'2026-11-09T00:00:00Z',actor_id:ids.admin,author:'Admin sintético',evidence:'Evidencia sintética',reference:'synthetic-ref',version:1,invalidated_at}]
 mocks.read.mockResolvedValue(response(view));render(<NotifyBuildingButton reservationId={ids.reservation}/>);await act(async()=>{})
 expect(screen.getByRole('button',{name:'Aviso al edificio'})).toHaveClass(green?'bg-green-100':'bg-slate-100')
 if(green)expect(screen.getByRole('button',{name:'Aviso al edificio'})).toHaveTextContent('7:30')
})

it('ofrece borradores verificados en un paso sin seleccionar, preparar ni escribir',async()=>{
 const view=buildingView({recipients:[buildingRecipient(),buildingRecipient({id:'10000000-0000-4000-8000-000000000008',channel:'whatsapp',address:'573000000000'}),buildingRecipient({id:'10000000-0000-4000-8000-000000000009',address:'candidate@example.test',verified_at:null})]})
 mocks.read.mockResolvedValue(response(view));render(<NotifyBuildingButton reservationId={ids.reservation}/>);fireEvent.click(screen.getByRole('button',{name:'Aviso al edificio'}))
 const link=await screen.findByRole('link',{name:'Correo · porter-sintetico@example.test'})
 expect(screen.getByRole('link',{name:'WhatsApp · 573000000000'})).toHaveAttribute('href',expect.stringContaining('https://wa.me/573000000000?text='))
 expect(screen.queryByRole('link',{name:/candidate/})).not.toBeInTheDocument()
 expect(screen.getByText('Registrar resultado o revisar destinatarios').closest('details')).not.toHaveAttribute('open')
 expect(screen.getByLabelText('Destinatario del edificio')).toHaveValue('')
 link.addEventListener('click',e=>e.preventDefault());fireEvent.click(link)
 expect(mocks.save).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Aviso al edificio'})).not.toHaveClass('bg-green-100')
 expect(decodeURIComponent(link.getAttribute('href')!)).toContain('Titular Sintético')
})
