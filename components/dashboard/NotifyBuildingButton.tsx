'use client'
import { HistoricalBuildingNoticeForm } from './HistoricalBuildingNoticeForm'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useUserRole } from '@/lib/user-context'
import { getBuildingNotices, manageBuildingNotice } from '@/actions/building-notices'
import { currentBuildingObservation, bogotaDateTimeLocal, noticeDraftLink, noticeMessage, noticeSnapshot, sameSnapshot, NOTICE_LABELS,
  type BuildingNoticeView, type NoticeAction } from '@/lib/building-notices'

const dateLabel = (iso: string) => new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(iso))
const evidenceKind: Record<NoticeAction, string> = {
  uncertain: 'uncertain_result', sent: 'operator_confirmation', delivered: 'delivery_receipt',
  received: 'recipient_acknowledgment', reviewed: 'review',
}

/** Preparar y abrir el borrador nunca confirma el envío. Los registros requieren comprobación humana. */
export function NotifyBuildingButton({ reservationId }: { reservationId: string }) {
  const role = useUserRole()
  return role === 'admin' ? <BuildingNoticeControl key={reservationId} reservationId={reservationId} /> : null
}

function BuildingNoticeControl({ reservationId }: { reservationId: string }) {
  const readSequence = useRef(0)
  const writeInFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<BuildingNoticeView | null>(null)
  const [recipientId, setRecipientId] = useState('')
  const [error, setError] = useState('')
  const [evidence, setEvidence] = useState('')
  const [review, setReview] = useState('')
  const [action, setAction] = useState<NoticeAction>('sent')
  const [occurred, setOccurred] = useState(bogotaDateTimeLocal)
  const [confirmed, setConfirmed] = useState(false)
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    let active = true
    // Se inicia fuera del efecto síncrono; la clave de reserva aísla todo el estado.
    void Promise.resolve().then(() => { if (active && readSequence.current === 0) return load() }).catch(() => {})
    return () => { active = false; readSequence.current += 1 }
    // Cada instancia está ligada a una reserva; load coordina las lecturas concurrentes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId])
  // Verde únicamente con un hecho acreditado y vigente, sea humano o del asistente.
  const accreditedTimes = view && !error && !pending && !view.blockers.length ? view.recipients.flatMap(contact => {
    if (!contact.verified_at) return []
    const historical = currentBuildingObservation(view, contact)
    if (historical) return Number.isFinite(Date.parse(historical.occurred_at)) ? [historical.occurred_at] : []
    const current = view.notices.find(n => n.recipient_id === contact.id && sameSnapshot(n.snapshot, noticeSnapshot(view, contact)))
    if (!current || current.review_reason || !['sent','delivered','received'].includes(current.status)) return []
    return [current.sent_at ?? current.delivered_at ?? current.received_at].filter((at): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at)))
  }) : []
  const notifiedAt = accreditedTimes.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)


  const recipient = view?.recipients.find(c => c.id === recipientId)
  const snapshot = view && recipient ? noticeSnapshot(view, recipient) : null
  const observation = view && recipient ? currentBuildingObservation(view, recipient) : null
  const currentNotice = view?.notices.find(n => n.recipient_id === recipientId && snapshot && sameSnapshot(n.snapshot, snapshot))
  const notice = currentNotice ?? view?.notices.find(n => n.recipient_id === recipientId)
  const message = snapshot && !view?.blockers.length ? noticeMessage(snapshot) : null
  const link = !error && !pending && view && recipient && notice ? noticeDraftLink(view, recipient, notice) : null

  async function load() {
    const sequence = ++readSequence.current
    try {
      const result = await getBuildingNotices(reservationId)
      if (sequence !== readSequence.current) return
      if (!result.ok) throw new Error(result.error)
      const next = result.data.arrivals.find(arrival => arrival.reservation.id === reservationId)
      if (!next) throw new Error('La reserva ya no está disponible.')
      setView(next); setError('')
    } catch (e) {
      if (sequence !== readSequence.current) return
      setView(null)
      setError(e instanceof Error ? e.message : 'No se pudo consultar el aviso.')
      throw e
    }
  }
  function refresh() {
    setView(null)
    startTransition(async () => {
      try { await load(); setRequestKey(crypto.randomUUID()) }
      catch { /* load deja el estado sin acreditar cuando falla. */ }
    })
  }
  function save(operation: 'verify_recipient' | 'prepare' | 'record') {
    if (!recipient || !view || pending || writeInFlight.current) return
    writeInFlight.current = true
    const input = operation === 'verify_recipient'
      ? { recipient_id: recipient.id, expected_version: recipient.version, evidence, request_key: requestKey }
      : operation === 'prepare'
        ? { reservation_id: reservationId, recipient_id: recipient.id, snapshot, request_key: requestKey,
            ...(review.trim() ? { review_confirmation: review.trim() } : {}) }
        : { notice_id: notice?.id, expected_version: notice?.version, action, confirmed,
            occurred_at: `${occurred}:00-05:00`, evidence, evidence_kind: evidenceKind[action], request_key: requestKey }
    startTransition(async () => {
      try {
        const result = await manageBuildingNotice(operation, input)
        if (!result.ok) { setError(result.error); return }
        await load()
        setError(''); setEvidence(''); setConfirmed(false); setRequestKey(crypto.randomUUID()); setOccurred(bogotaDateTimeLocal())
      } catch {
        setError('No se pudo comprobar el resultado. Actualiza el estado antes de repetir el registro.')
      } finally { writeInFlight.current = false }
    })
  }
  return <div className="mt-2 border-t pt-2 text-xs" data-home-edit-error={Boolean(error) || pending}>
    <button type="button" className={`min-h-11 rounded-lg px-3 font-semibold ${notifiedAt ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`} aria-label="Aviso al edificio" aria-expanded={open}
      onClick={() => { setOpen(!open); if (!open) refresh() }}>📨 {notifiedAt ? `Avisado · ${dateLabel(notifiedAt)}` : 'Avisar edificio'} {open ? '▲' : '▼'}</button>
    {open ? <div className="space-y-3">
      <button type="button" onClick={refresh} disabled={pending} className="min-h-11 underline">Actualizar estado</button>
      {view?.legacy_marks.map(mark => <p key={mark.task_id} className="text-amber-900">
        Marca anterior del {dateLabel(mark.at)}. Sin evidencia de envío asociada.</p>)}
      {view?.blockers.map(reason => <p key={reason} className="text-amber-900">{reason}</p>)}
      {view && !view.recipients.length ? <p>Falta configurar y verificar un destinatario de este apartamento.</p> : null}
      {view?.recipients.length ? <label className="block">Destinatario del edificio
        <select value={recipientId} disabled={pending} className="mt-1 min-h-11 w-full rounded border p-2"
          onChange={e => { setRecipientId(e.target.value); setEvidence(''); setReview(''); setConfirmed(false); setRequestKey(crypto.randomUUID()) }}>
          <option value="">Selecciona un destinatario</option>
          {view.recipients.map(c => <option key={c.id} value={c.id}>{c.channel === 'email' ? 'Correo' : 'WhatsApp'} · {c.address} · {c.verified_at ? 'Verificado' : 'Por verificar'}</option>)}
        </select>
      </label> : null}
      {recipient && view ? <>
        <p className="break-all">{recipient.channel === 'email' ? 'Correo' : 'WhatsApp'}: {recipient.address}
          {` · ${recipient.verified_at ? 'Verificado' : 'Pendiente de verificar'}`}</p>
        <p className="font-semibold">{observation ? `${NOTICE_LABELS[observation.status]} · evidencia histórica vigente` : notice ? `${NOTICE_LABELS[notice.status]} · contenido ${notice.content_version}` : 'Borrador pendiente'}</p>
        {notice?.review_reason ? <p className="text-amber-900">{notice.review_reason}</p> : null}
        {message ? <details><summary className="min-h-11 cursor-pointer py-3">Revisar texto propuesto</summary>
          <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-sans">{recipient.channel === 'email'
            ? `${message.emailSubject}\n\n${message.emailBody}` : message.whatsappText}</pre>
        </details> : null}
        {!recipient.verified_at ? <>
          <p>Comprueba que este contacto corresponde a la portería o administración de este apartamento.</p>
          <label className="block">Cómo verificaste el destinatario
            <textarea value={evidence} onChange={e => setEvidence(e.target.value)} disabled={pending} maxLength={500}
              className="mt-1 w-full rounded border p-2" rows={2} />
          </label>
          <button type="button" onClick={() => save('verify_recipient')} disabled={pending || evidence.trim().length < 10}
            className="min-h-11 rounded border px-3 disabled:opacity-50">Confirmar destinatario</button>
        </> : <>
          {!observation && !currentNotice && (view.legacy_marks.length > 0 || view.notices.length > 0) ? <label className="block">Revisión del aviso anterior, si preparas otra versión
            <textarea value={review} onChange={e => setReview(e.target.value)} disabled={pending} maxLength={500}
              className="mt-1 w-full rounded border p-2" rows={2} />
          </label> : null}
          {!observation && !currentNotice ? <button type="button" onClick={() => save('prepare')} disabled={pending || view.blockers.length > 0}
            className="min-h-11 rounded border px-3 disabled:opacity-50">Preparar borrador</button> : null}
          {link ? <div className="space-y-1">
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded border px-3 text-indigo-700">
              Abrir borrador en {recipient.channel === 'email' ? 'correo' : 'WhatsApp'}</a>
            <p>Revísalo y envíalo en esa aplicación. Después registra aquí lo que comprobaste.</p>
          </div> : null}
          {!observation && notice ? <fieldset disabled={pending || view.blockers.length > 0} className="space-y-2 rounded border p-2">
            <legend>Registrar resultado</legend>
            <label className="block">Resultado comprobado
              <select value={action} onChange={e => { setAction(e.target.value as NoticeAction); setConfirmed(false); setRequestKey(crypto.randomUUID()) }}
                className="mt-1 min-h-11 w-full rounded border p-2">
                <option value="sent">Envío confirmado por mí</option><option value="uncertain">No sé si se envió</option>
                <option value="delivered">Tengo comprobante de entrega</option><option value="received">El destinatario confirmó recepción</option>
                <option value="reviewed">He revisado la vigencia del aviso</option>
              </select>
            </label>
            <label className="block">Fecha y hora del hecho · Colombia
              <input type="datetime-local" value={occurred} onChange={e => setOccurred(e.target.value)} className="mt-1 min-h-11 w-full rounded border p-2" />
            </label>
            <label className="block">Evidencia o referencia del hecho (10–500 caracteres)
              <textarea value={evidence} onChange={e => setEvidence(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded border p-2" />
            </label>
            <p>Usa una referencia del mensaje o comprobación. Conserva documentos y códigos de acceso fuera de este registro.</p>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
              Confirmo que comprobé este resultado y su evidencia.</label>
            <button type="button" onClick={() => save('record')} disabled={pending || !confirmed || evidence.trim().length < 10 || !occurred}
              className="min-h-11 rounded border px-3 disabled:opacity-50">Guardar registro</button>
          </fieldset> : null}
          {observation ? <p>Ya hay evidencia histórica vigente. No se ofrece preparar ni reenviar este aviso.</p> : null}
          {snapshot && !view.blockers.length ? <HistoricalBuildingNoticeForm key={`${recipient.id}:${recipient.version}`} reservationId={reservationId} snapshot={snapshot} reload={load} /> : null}
        </>}
      </> : null}
      {pending ? <p role="status">Consultando o guardando…</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </div> : null}
  </div>
}
