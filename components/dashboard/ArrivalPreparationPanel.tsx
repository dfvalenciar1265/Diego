'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveArrivalPreparation } from '@/actions/preparation'
import { canConfirmPreparation, preparationConfirmation, PREPARATION_STEPS, type PreparationStep, type PreparationView } from '@/lib/preparation'
import type { UserRole } from '@/lib/types'

const labels: Record<PreparationStep, string> = {
  cleaning: 'Limpieza terminada', functioning: 'Revisión de funcionamiento', ready: 'Listo para recibir',
}
const buttons: Record<PreparationStep, string> = {
  cleaning: 'Confirmar limpieza', functioning: 'Confirmar revisión', ready: 'Confirmar listo',
}
function localDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
export function ArrivalPreparationPanel({ reservation, preparation: view, role }: {
  reservation: { id: string; check_in: string; check_out: string }
  preparation: PreparationView; role: UserRole
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [reopen, setReopen] = useState<PreparationStep | null>(null)
  const [reason, setReason] = useState('')
  const request = useRef({ signature: '', key: '' })
  const router = useRouter()
  const ready = view.available && Boolean(view.state?.ready_at) && view.blockers.length === 0
  function save(step: PreparationStep, confirmed: boolean) {
    const input = { reservation_id: reservation.id, stay_check_in: reservation.check_in, stay_check_out: reservation.check_out,
      step, confirmed, expected_version: view.state?.version ?? 0, reason: confirmed ? '' : reason.trim() }
    const signature = JSON.stringify(input)
    if (request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() }
    setMessage('')
    startTransition(async () => {
      try {
        const result = await saveArrivalPreparation({ ...input, request_key: request.current.key })
        if (!result.success) { setMessage(result.error ?? 'No se guardó la preparación.'); return }
        setMessage('Confirmación guardada.')
        setReopen(null)
        setReason('')
        router.refresh()
      } catch { setMessage('Resultado incierto. Actualiza la preparación antes de reintentar.') }
    })
  }
  return <div className="mt-2 space-y-2 border-t border-[#e2e8f0] pt-2 text-xs">
    {view.issues.length > 0 ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
      <p className="font-semibold text-amber-900">⚠ Incidencias en este apartamento ({view.issues.length})</p>
      <ul className="mt-1 space-y-1 text-amber-950">{view.issues.map(issue => <li key={issue.id}>
        {issue.priority === 'urgent' ? <strong>Urgente · </strong> : null}{issue.title}
      </li>)}</ul>
      <Link href="/maintenance" className="inline-flex min-h-11 items-center font-medium underline">Ver en Mantenimiento</Link>
    </div> : null}
    {view.requests.length > 0 ? <ul className="space-y-1 text-[#475569]">{view.requests.map(q => <li key={q.id}>
      {q.status === 'ready' && !q.review_reason ? '✓' : '⚠'} {q.description} · {q.status === 'ready' && !q.review_reason ? 'lista' : 'pendiente o por revisar'}
    </li>)}</ul> : null}
    {view.error ? <p role="alert" className="text-amber-900">{view.error}</p> : null}
    {view.state?.review_reason ? <p className="rounded bg-amber-50 p-2 text-amber-900">{view.state.review_reason}</p> : null}
    <ol className="divide-y divide-[#f1f5f9]">{PREPARATION_STEPS.map(step => {
      const fact = preparationConfirmation(view.state, step)
      const confirmed = view.available && Boolean(fact.at) && (step !== 'ready' || ready)
      const permitted = canConfirmPreparation(role, step)
      const blocked = !view.available || !view.can_confirm
        || (step === 'functioning' && (!view.state?.cleaned_at || view.issues.some(i => i.priority === 'urgent')))
        || (step === 'ready' && view.blockers.length > 0)
      return <li key={step} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1">
        <span className="min-w-0 flex-1 text-[#0f172a]">{confirmed ? '✓' : '○'} {labels[step]}</span>
        {confirmed ? <>{permitted ? <button disabled={pending} className="min-h-11 px-1 text-[#64748b] underline disabled:opacity-50"
          aria-label={`Reabrir ${labels[step]}`} onClick={() => { setReopen(step); setReason('') }}>Reabrir</button> : <span className="text-green-700">Confirmada</span>}</>
          : permitted ? <button disabled={pending || blocked} onClick={() => save(step, true)}
            className="min-h-11 rounded border border-[#e2e8f0] px-2 font-medium text-[#0f172a] disabled:opacity-40">{buttons[step]}</button>
            : <span className="text-[#64748b]">Pendiente</span>}
      </li>
    })}</ol>
    {!ready && view.available && view.blockers.length > 0 ? <p className="text-[#64748b]">{view.blockers[0]}</p> : null}
    {role !== 'admin' && role !== 'anfitrion' ? <p className="text-[#64748b]">Administración o anfitrión confirma «Listo para recibir».</p> : null}
    {reopen ? <div className="space-y-2 rounded border border-amber-200 p-2">
      <label className="block">Motivo para reabrir: {labels[reopen]}
        <input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} className="mt-1 min-h-11 w-full rounded border p-2" />
      </label>
      <p className="text-[#64748b]">Las etapas posteriores también quedarán pendientes.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={pending || !reason.trim()} onClick={() => save(reopen, false)} className="min-h-11 rounded border px-2 disabled:opacity-40">Confirmar reapertura</button>
        <button disabled={pending} onClick={() => setReopen(null)} className="min-h-11 px-2">Cancelar</button>
      </div>
    </div> : null}
    {message ? <p role="status">{message} <button onClick={() => router.refresh()} className="min-h-11 underline">Actualizar preparación</button></p> : null}
    <details className="text-[#64748b]">
      <summary className="min-h-11 cursor-pointer py-3">Quién confirmó e historial reciente</summary>
      <p className="break-words">Reserva {reservation.id} · {reservation.check_in} a {reservation.check_out}</p>
      {PREPARATION_STEPS.map(step => {
        const fact = preparationConfirmation(view.state, step)
        return fact.at ? <p key={step}>{labels[step]} · {fact.name} · {localDate(fact.at)} · Colombia</p> : null
      })}
      {view.history.map(event => <p key={event.id} className="mt-1 break-words">
        #{event.version} · {event.author} · {event.source === 'mcp' ? 'Asistente' : event.source === 'app' ? 'AirAdmin' : 'Sistema'} · {localDate(event.at)} · {event.action === 'invalidated' ? 'Vuelve a revisión' :
          `${labels[event.action.split(':')[0] as PreparationStep] ?? 'Preparación'}: ${event.action.endsWith(':confirmed') ? 'confirmada' : 'reabierta'}`}
        {event.reason ? ` · ${event.reason}` : ''}
      </p>)}
      {view.history.length === 0 ? <p>Aún no hay confirmaciones registradas para esta llegada.</p> : null}
    </details>
  </div>
}
