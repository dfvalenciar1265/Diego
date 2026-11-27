'use client'
import { Settings2 } from 'lucide-react'
import { HistoricalBuildingNoticeForm } from './HistoricalBuildingNoticeForm'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useUserRole } from '@/lib/user-context'
import { getBuildingNotices, manageBuildingNotice } from '@/actions/building-notices'
import { currentBuildingObservation, bogotaDateTimeLocal, directBuildingDraftLink, noticeMessage, noticeSnapshot, sameSnapshot, NOTICE_LABELS,
  type BuildingNotice, type BuildingNoticeView, type BuildingRecipient, type NoticeAction, type NoticeSnapshot } from '@/lib/building-notices'

const dateLabel = (iso: string) => new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(iso))
const evidenceKind: Record<NoticeAction, string> = {
  uncertain: 'uncertain_result', sent: 'operator_confirmation', delivered: 'delivery_receipt',
  received: 'recipient_acknowledgment', reviewed: 'review',
}

const sendEvidence = 'El operador confirmó que envió el aviso al destinatario indicado por el canal seleccionado.'
type OpenedDraft = { snapshot: NoticeSnapshot; key: string }
type SendRecord = { notice_id: string; expected_version: number; occurred_at: string }

function sentTime(view: BuildingNoticeView, contact: BuildingRecipient) {
  if (!contact.verified_at || view.blockers.length) return
  const observation = currentBuildingObservation(view, contact)
  if (observation) return Number.isFinite(Date.parse(observation.occurred_at)) ? observation.occurred_at : undefined
  const current = view.notices.find(n => n.recipient_id === contact.id && sameSnapshot(n.snapshot, noticeSnapshot(view, contact)))
  if (!current || current.review_reason || !['sent', 'delivered', 'received'].includes(current.status)) return
  const time = current.sent_at ?? current.delivered_at ?? current.received_at
  return time && Number.isFinite(Date.parse(time)) ? time : undefined
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
  const [openedDrafts, setOpenedDrafts] = useState<Record<string, OpenedDraft>>({})
  const sendAttempts = useRef(new Map<string, SendRecord>())
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
  const statusView = error || pending ? null : view
  const sentByRecipient = new Map(statusView?.recipients.map(contact => [contact.id, sentTime(statusView, contact)]))
  const accreditedTimes = [...sentByRecipient.values()].filter((time): time is string => Boolean(time))
  const allNotified = accreditedTimes.length > 0 && accreditedTimes.length === statusView?.recipients.length
  const notifiedAt = allNotified ? accreditedTimes.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) : undefined
  const noticeLabel = notifiedAt ? `Avisado · ${dateLabel(notifiedAt)}`
    : accreditedTimes.length ? `Aviso parcial · ${accreditedTimes.length}/${statusView?.recipients.length}`
      : error ? 'Aviso por verificar' : !statusView ? 'Consultando aviso…' : 'Pendiente de avisar'

  const recipient = view?.recipients.find(c => c.id === recipientId)
  const snapshot = view && recipient ? noticeSnapshot(view, recipient) : null
  const observation = view && recipient ? currentBuildingObservation(view, recipient) : null
  const currentNotice = view?.notices.find(n => n.recipient_id === recipientId && snapshot && sameSnapshot(n.snapshot, snapshot))
  const notice = currentNotice ?? view?.notices.find(n => n.recipient_id === recipientId)
  const message = snapshot && !view?.blockers.length ? noticeMessage(snapshot) : null

  async function load() {
    const sequence = ++readSequence.current
    try {
      const result = await getBuildingNotices(reservationId)
      if (sequence !== readSequence.current) return
      if (!result.ok) throw new Error(result.error)
      const next = result.data.arrivals.find(arrival => arrival.reservation.id === reservationId)
      if (!next) throw new Error('La reserva ya no está disponible.')
      setView(next); setError('')
      return next
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
  function rememberDraft(contact: BuildingRecipient, current: BuildingNoticeView) {
    const snapshot = noticeSnapshot(current, contact)
    setOpenedDrafts(previous => {
      const existing = previous[contact.id]
      if (existing && sameSnapshot(existing.snapshot, snapshot)) return previous
      return { ...previous, [contact.id]: { snapshot, key: crypto.randomUUID() } }
    })
  }

  function confirmManualSend(draft: OpenedDraft) {
    if (pending || writeInFlight.current) return
    writeInFlight.current = true
    startTransition(async () => {
      try {
        const latest = await getBuildingNotices(reservationId)
        if (!latest.ok) throw new Error(latest.error)
        const current = latest.data.arrivals.find(arrival => arrival.reservation.id === reservationId)
        const contact = current?.recipients.find(c => c.id === draft.snapshot.recipient_id)
        if (!current || !contact || !sameSnapshot(draft.snapshot, noticeSnapshot(current, contact))) {
          throw new Error('Cambió la reserva o el destinatario. Actualiza el aviso antes de registrarlo.')
        }
        if (sentTime(current, contact)) {
          await load()
          return
        }
        if (!directBuildingDraftLink(current, contact)) {
          throw new Error('Este aviso necesita revisión antes de confirmar el envío.')
        }
        let record = sendAttempts.current.get(draft.key)
        if (!record) {
          let prepared: BuildingNotice | undefined = current.notices.find(n =>
            n.recipient_id === contact.id && sameSnapshot(n.snapshot, draft.snapshot))
          if (!prepared) {
            const result = await manageBuildingNotice('prepare', {
              reservation_id: reservationId, recipient_id: contact.id,
              snapshot: draft.snapshot, request_key: `${draft.key}:prepare`,
            })
            if (!result.ok) throw new Error(result.error)
            if ('snapshot' in result.data) prepared = result.data
          }
          if (!prepared || prepared.reservation_id !== reservationId || prepared.recipient_id !== contact.id ||
            !sameSnapshot(prepared.snapshot, draft.snapshot) || prepared.status !== 'prepared' || prepared.review_reason) {
            throw new Error('El aviso cambió. Actualiza su estado antes de repetir la confirmación.')
          }
          record = { notice_id: prepared.id, expected_version: prepared.version, occurred_at: new Date().toISOString() }
          sendAttempts.current.set(draft.key, record)
        }
        const result = await manageBuildingNotice('record', {
          ...record, action: 'sent', confirmed: true, evidence: sendEvidence,
          evidence_kind: 'operator_confirmation', request_key: `${draft.key}:sent`,
        })
        if (!result.ok) throw new Error(result.error)
        const saved = await load()
        const savedContact = saved?.recipients.find(c => c.id === contact.id)
        if (!saved || !savedContact || !sentTime(saved, savedContact)) {
          throw new Error('No se pudo verificar el envío guardado. Actualiza el estado antes de repetir.')
        }
        sendAttempts.current.delete(draft.key)
        setOpenedDrafts(previous => {
          const next = { ...previous }
          delete next[contact.id]
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo comprobar el registro. Actualiza antes de volver a intentar.')
      } finally { writeInFlight.current = false }
    })
  }

  return <div className="mt-2 border-t pt-2 text-xs" data-home-edit-error={Boolean(error) || pending}>
    <button type="button" className={`min-h-11 rounded-lg px-3 font-semibold ${notifiedAt ? 'bg-green-100 text-green-800' : accreditedTimes.length ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`} aria-label="Aviso al edificio" aria-expanded={open}
      onClick={() => { setOpen(!open); if (!open) refresh() }}>📨 {noticeLabel} {open ? '▲' : '▼'}</button>
    {open ? <div className="space-y-3">
      <button type="button" onClick={refresh} disabled={pending} className="min-h-11 underline">Actualizar estado</button>
      {view?.legacy_marks.map(mark => <p key={mark.task_id} className="text-amber-900">
        Marca anterior del {dateLabel(mark.at)}. Sin evidencia de envío asociada.</p>)}
      {view?.blockers.map(reason => <p key={reason} className="text-amber-900">{reason}</p>)}
      {view && !view.recipients.length ? <p>Falta configurar y verificar un destinatario de este apartamento.</p> : null}
      {view && !error && !pending ? <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        {view.recipients.map(contact => {
          const draft = directBuildingDraftLink(view, contact)
          const at = sentByRecipient.get(contact.id)
          const opened = openedDrafts[contact.id]
          const confirmable = draft && opened && sameSnapshot(opened.snapshot, noticeSnapshot(view, contact))
          const label = contact.channel === 'email' ? 'Correo' : 'WhatsApp'
          const content = <><span className="font-semibold">{label}</span><span className="min-w-0 break-all text-xs">{contact.address}</span></>
          return <div key={contact.id} className="min-w-0">
            {at ? <div className="flex min-h-16 flex-col justify-center gap-1 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-green-800">
              {content}<span className="text-xs">Avisado · {dateLabel(at)}</span>
            </div> : draft ? <a href={draft} target="_blank" rel="noopener noreferrer" aria-label={`${label} · ${contact.address}`}
              onClick={() => rememberDraft(contact, view)}
              className="flex min-h-16 w-full min-w-0 flex-col justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-600">
              {content}<span className="text-xs">Pendiente de avisar</span>
            </a> : <button type="button" disabled aria-label={`${label} ${contact.address} ${contact.verified_at ? 'Sin reenvío disponible' : 'Pendiente de verificar'}`} className="flex min-h-16 w-full min-w-0 flex-col justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-slate-500">
              {content}<span className="text-xs">{contact.verified_at ? 'Sin reenvío disponible' : 'Pendiente de verificar'}</span>
            </button>}
            {confirmable ? <button type="button" onClick={() => confirmManualSend(opened)} disabled={pending}
              aria-label={`Confirmar envío por ${label} a ${contact.address}`}
              className="mt-1 min-h-11 w-full rounded-lg border border-green-300 px-3 font-semibold text-green-800 disabled:opacity-50">
              Confirmar envío
            </button> : null}
          </div>
        })}
      </div> : null}
      <details><summary aria-label="Gestionar aviso" title="Gestionar aviso" className="flex min-h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border text-slate-600 focus-visible:outline-2"><Settings2 size={18} aria-hidden="true" /></summary>
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
          {snapshot && !view.blockers.length ? <HistoricalBuildingNoticeForm key={`${recipient.id}:${recipient.version}`} reservationId={reservationId} snapshot={snapshot} reload={async () => { await load() }} /> : null}
        </>}
      </> : null}
      </details>
      {pending ? <p role="status">Consultando o guardando…</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </div> : null}
  </div>
}
