'use client'
import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { saveReservationTime } from '@/actions/reservation-times'
import type { ReservationTiming, TimeFact } from '@/lib/reservation-times'

const sourceLabels: Record<string, string> = { app: 'AirAdmin', mcp: 'Asistente', gmail: 'Correo', legacy: 'Nota heredada', legacy_reservation_notes: 'Reserva heredada', operation_policy: 'Política operativa' }
const kindLabels = { estimate: 'Hora avisada', authorization: 'Autorización', platform: 'Horario de Airbnb' }
function clockLabel(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'a. m.' : 'p. m.'}`
}
function provenance(fact: TimeFact) {
  const date = fact.observed_at ? new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(fact.observed_at)) : 'Fecha original desconocida'
  return `${sourceLabels[fact.source] ?? fact.source} · ${fact.author} · ${date} · reserva ${fact.reservation_id} · ${fact.service_date}`
}

export function ReservationTimePanel({ timing, stay, canEdit = false, heading }: {
  timing: ReservationTiming
  stay: { check_in: string; check_out: string }
  canEdit?: boolean
  heading?: ReactNode
}) {
  const [estimate, setEstimate] = useState(timing.estimate?.time ?? '')
  const [authorization, setAuthorization] = useState(timing.authorization?.time ?? '')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const request = useRef({ signature: '', key: '' })
  const router = useRouter()
  const isArrival = timing.direction === 'checkin'
  const specialTime = timing.authorization && timing.authorization.time !== timing.standard.time
  // Una nota antigua que repite el estándar no cambia la instrucción de trabajo.
  // La falta de autor/fecha se conserva en los detalles; los demás avisos siguen visibles.
  const routineLegacy = timing.authorization?.source === 'legacy' && !specialTime
  const visibleReview = timing.review.filter(text => !(routineLegacy
    && text === 'Excepción heredada: autor y fecha originales desconocidos.'))
  function reviewLabel(text: string) {
    if (text === 'La ETA es anterior a la entrada permitida; no autoriza check-in temprano.') {
      return `Avisó que llega antes. La entrada sigue siendo desde las ${clockLabel(timing.effective_time)}.`
    }
    if (text === 'La salida estimada supera la hora permitida; requiere autorización.') {
      return 'Avisó que sale después de la hora permitida. Falta autorizar ese horario.'
    }
    if (text === 'Excepción heredada: autor y fecha originales desconocidos.') {
      return 'Horario de una nota antigua: confirmar con administración.'
    }
    return text.replaceAll('ETA', 'hora avisada')
  }
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
    <div className="space-y-1 text-xs text-[#64748b]">
      <div className="flex items-start justify-between gap-3">
        {heading ? <div className="min-w-0 flex-1">{heading}</div> : null}
        <p className={`shrink-0 ${heading ? 'text-right' : ''}`}>
          <span className="block text-[11px]">{isArrival ? 'Entrada desde las' : 'Salida hasta las'}</span>
          <strong className={`text-lg font-semibold ${isArrival ? 'text-[#e11d48]' : 'text-[#15803d]'}`}>
            {clockLabel(timing.effective_time)}
          </strong>
        </p>
      </div>
      {specialTime ? <p className="font-medium text-[#0f172a]">Horario especial autorizado</p> : null}
      {timing.estimate ? <p>{isArrival ? 'Avisó llegada:' : 'Avisó salida:'} <strong>{clockLabel(timing.estimate.time)}</strong></p> : null}
      {visibleReview.map(text => <p key={text} className="rounded bg-amber-50 px-2 py-1 text-amber-900">⚠ {reviewLabel(text)}</p>)}
      <details>
        <summary className="min-h-11 cursor-pointer py-3">{canEdit ? 'Ver o ajustar horario' : 'Ver detalles del horario'}</summary>
        <div className="space-y-2 border-t border-[#e2e8f0] pt-2">
          <p>Horas de Colombia.</p>
          {[
            { label: 'Horario habitual', fact: timing.standard, empty: '' },
            { label: 'Hora avisada por el huésped', fact: timing.estimate, empty: 'Sin comunicar' },
            { label: 'Horario especial autorizado', fact: timing.authorization, empty: 'Ninguno' },
            { label: 'Horario del correo de Airbnb', fact: timing.platform, empty: 'Sin registrar' },
          ].map(({ label, fact, empty }) => <div key={label}>
            <p className="font-medium text-[#0f172a]">{label}: {fact?.time ?? empty}</p>
            {fact ? <p className="break-words">{provenance(fact)}</p> : null}
          </div>)}
          {timing.review.map(text => <p key={text} className="text-amber-900">{text}</p>)}
          {timing.history.length > 0 ? <details>
            <summary className="min-h-11 cursor-pointer py-3">Fuente e historial ({timing.history.length})</summary>
            {timing.history.map(event => <p key={event.id} className="mt-1 break-words">
              #{event.version} · {kindLabels[event.kind]} · {event.time ?? 'Retirado'} · {sourceLabels[event.source]} · {event.author} · {event.observed_at ?? 'Fecha original desconocida'}
              {event.invalidated_at ? ' · Requiere nueva confirmación' : ''}
            </p>)}
          </details> : null}
          {canEdit ? <div className="space-y-2 border-t border-[#e2e8f0] pt-2">
            <div className="flex flex-wrap items-end gap-2">
              <label>Hora que avisó el huésped<input type="time" value={estimate}
                onChange={e => setEstimate(e.target.value)} className="ml-1 min-h-11 rounded border p-2" /></label>
              <button disabled={pending} onClick={() => save('estimate', estimate)} className="min-h-11 rounded border px-3 py-2">Guardar hora avisada</button>
            </div>
            <p>Guardar la hora avisada no cambia la hora permitida.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label>Hora permitida por administración<input type="time" value={authorization}
                onChange={e => setAuthorization(e.target.value)} className="ml-1 min-h-11 rounded border p-2" /></label>
              <button disabled={pending} onClick={() => save('authorization', authorization)} className="min-h-11 rounded border px-3 py-2">
                {authorization ? 'Autorizar horario especial' : 'Quitar horario especial'}
              </button>
            </div>
          </div> : null}
        </div>
      </details>
      {message ? <p role="status">{message} <button className="underline" onClick={() => router.refresh()}>Actualizar horarios</button></p> : null}
    </div>
  )
}
