'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveReservationTime } from '@/actions/reservation-times'
import type { ReservationTiming, TimeFact } from '@/lib/reservation-times'

const sourceLabels: Record<string, string> = { app: 'App', mcp: 'MCP', gmail: 'Correo', legacy: 'Nota heredada', legacy_reservation_notes: 'Reserva heredada', operation_policy: 'Política operativa' }
const kindLabels = { estimate: 'ETA', authorization: 'Autorización', platform: 'Horario de Airbnb' }
function provenance(fact: TimeFact) {
  const date = fact.observed_at ? new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(fact.observed_at)) : 'Fecha original desconocida'
  return `${sourceLabels[fact.source] ?? fact.source} · ${fact.author} · ${date} · reserva ${fact.reservation_id} · ${fact.service_date}`
}

export function ReservationTimePanel({ timing, stay, canEdit = false }: {
  timing: ReservationTiming
  stay: { check_in: string; check_out: string }
  canEdit?: boolean
}) {
  const [estimate, setEstimate] = useState(timing.estimate?.time ?? '')
  const [authorization, setAuthorization] = useState(timing.authorization?.time ?? '')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const request = useRef({ signature: '', key: '' })
  const router = useRouter()
  function save(kind: 'estimate' | 'authorization', value: string) {
    const signature = `${timing.version}:${kind}:${value}`
    if (request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() }
    setMessage('')
    startTransition(async () => {
      try {
        const result = await saveReservationTime({
          reservation_id: timing.reservation_id, direction: timing.direction, kind, time: value || null,
          expected_version: timing.version, request_key: request.current.key,
          stay_check_in: stay.check_in, stay_check_out: stay.check_out,
        })
        if (!result.success) { setMessage(result.error ?? 'No se guardó.'); return }
        setMessage('Guardado.')
        router.refresh()
      } catch { setMessage('Resultado incierto. Actualiza los horarios antes de reintentar.') }
    })
  }
  return (
    <div className="mt-2 space-y-1 text-xs text-[#64748b]">
      <p>Estándar: <strong>{timing.standard.time}</strong> · Colombia</p>
      <p>ETA del huésped: <strong>{timing.estimate?.time ?? 'Sin comunicar'}</strong></p>
      <p>Excepción autorizada: <strong>{timing.authorization?.time ?? 'Ninguna'}</strong></p>
      <p className="font-medium text-[#0f172a]">Hora permitida: {timing.effective_time}</p>
      {timing.review.map(text => <p key={text} className="text-amber-800">⚠️ {text}</p>)}
      <details>
        <summary className="cursor-pointer">Fuente e historial ({timing.history.length})</summary>
        {[timing.standard, timing.estimate, timing.authorization, timing.platform].map((fact, index) => fact ? (
          <p key={index} className="mt-1 break-words">{fact.time} · {provenance(fact)}</p>
        ) : null)}
        {timing.history.map(event => <p key={event.id} className="mt-1 break-words">
          #{event.version} · {kindLabels[event.kind]} · {event.time ?? 'Retirado'} · {sourceLabels[event.source]} · {event.author} · {event.observed_at ?? 'Fecha original desconocida'}
          {event.invalidated_at ? ' · Requiere nueva confirmación' : ''}
        </p>)}
      </details>
      {canEdit ? <details className="pt-1">
        <summary className="cursor-pointer font-medium">Registrar ETA o autorizar excepción</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label>ETA comunicada<input aria-label="ETA comunicada" type="time" value={estimate}
            onChange={e => setEstimate(e.target.value)} className="ml-1 rounded border p-1" /></label>
          <button disabled={pending} onClick={() => save('estimate', estimate)} className="rounded border px-2 py-1">Guardar ETA</button>
        </div>
        <p className="mt-1">Registrar una ETA no autoriza una entrada temprana ni una salida tardía.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label>Hora autorizada<input aria-label="Hora autorizada" type="time" value={authorization}
            onChange={e => setAuthorization(e.target.value)} className="ml-1 rounded border p-1" /></label>
          <button disabled={pending} onClick={() => save('authorization', authorization)} className="rounded border px-2 py-1">
            {authorization ? 'Autorizar excepción' : 'Retirar excepción'}
          </button>
        </div>
      </details> : null}
      {message ? <p role="status">{message} <button className="underline" onClick={() => router.refresh()}>Actualizar horarios</button></p> : null}
    </div>
  )
}
