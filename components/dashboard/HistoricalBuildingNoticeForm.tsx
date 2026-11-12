'use client'
import { useRef, useState } from 'react'
import { recordHistoricalBuildingNotice } from '@/actions/building-notices'
import type { NoticeSnapshot } from '@/lib/building-notices'

export function HistoricalBuildingNoticeForm({ reservationId, snapshot, reload }: {
  reservationId: string; snapshot: NoticeSnapshot; reload: () => Promise<void>
}) {
  const [status, setStatus] = useState<'sent' | 'delivered' | 'received'>('sent')
  const [occurred, setOccurred] = useState('')
  const [evidence, setEvidence] = useState('')
  const [reference, setReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const flight = useRef(false)
  const request = useRef({ signature: '', key: '' })
  async function save() {
    if (flight.current || !confirmed) return
    const input = { reservation_id: reservationId, recipient_id: snapshot.recipient_id, snapshot, expected_version: 0,
      status, occurred_at: `${occurred}:00-05:00`, evidence: evidence.trim(), reference: reference.trim(), confirmed: true }
    const signature = JSON.stringify(input)
    if (request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() }
    flight.current = true; setBusy(true); setMessage('')
    try {
      const result = await recordHistoricalBuildingNotice({ ...input, request_key: request.current.key })
      if (!result.ok) { setMessage(result.error); return }
      await reload(); setMessage(result.data.invalidated_at ? 'Hecho histórico guardado; requiere revisión por cambios. No se envió ningún mensaje.' : 'Hecho histórico guardado y verificado. Consulta su vigencia actual en el historial. No se envió ningún mensaje.'); setConfirmed(false)
    } catch { setMessage('Resultado incierto. Actualiza y comprueba antes de repetir; conserva la referencia.') }
    finally { flight.current = false; setBusy(false) }
  }
  return <details className="rounded border p-2">
    <summary className="min-h-11 cursor-pointer py-3 font-semibold">Registrar un aviso enviado anteriormente</summary>
    <fieldset disabled={busy} className="space-y-2">
      <p>Solo registra un hecho comprobado para este destinatario verificado y los datos actuales de la estancia. No prepara, envía ni completa etapas anteriores.</p>
      <p className="break-words">{snapshot.apartment} · {snapshot.guest_name} · {snapshot.guests} huéspedes · {snapshot.check_in} a {snapshot.check_out} · {snapshot.address}</p>
      <label className="block">Hecho histórico comprobado<select value={status} onChange={e => {setStatus(e.target.value as typeof status); setConfirmed(false)}} className="min-h-11 w-full rounded border p-2">
        <option value="sent">Enviado</option><option value="delivered">Entregado</option><option value="received">Recepción confirmada</option>
      </select></label>
      <label className="block">Cuándo ocurrió · Colombia<input type="datetime-local" value={occurred} onChange={e => {setOccurred(e.target.value); setConfirmed(false)}} className="min-h-11 w-full rounded border p-2" /></label>
      <label className="block">Referencia única del mensaje o comprobante<input value={reference} maxLength={200} onChange={e => {setReference(e.target.value); setConfirmed(false)}} className="min-h-11 w-full rounded border p-2" /></label>
      <label className="block">Evidencia histórica (10–500 caracteres)<textarea value={evidence} maxLength={500} onChange={e => {setEvidence(e.target.value); setConfirmed(false)}} className="w-full rounded border p-2" /></label>
      <p>No incluyas documentos, claves ni datos privados. La fecha de registro será la actual, separada de la fecha del hecho.</p>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Comprobé el hecho, destinatario, fechas y contenido de esta estancia.</label>
      <button type="button" onClick={save} disabled={busy || !confirmed || !occurred || !reference.trim() || evidence.trim().length < 10} className="min-h-11 rounded border px-3 disabled:opacity-50">Guardar hecho histórico</button>
      {message ? <p role="status">{message}</p> : null}
    </fieldset>
  </details>
}
