'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { inspectionPhotoUrl, saveInspection, uploadInspectionPhoto } from '@/actions/inspection'
import { INSPECTION_ITEMS, inspectionCurrent, inspectionProgress, type InspectionState, type InspectionStay, type InspectionItem, type InspectionResult } from '@/lib/inspection'

export function InspectionChecklistPanel({ stay, initial, canEdit }: { stay: InspectionStay; initial: InspectionState | null; canEdit: boolean }) {
  const [state, setState] = useState(initial)
  const [active, setActive] = useState<InspectionItem | null>(null)
  const [result, setResult] = useState<InspectionResult>('checked')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [photoLink, setPhotoLink] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const request = useRef<{ signature: string; key: string; photo: File | null; path: string | null }>({ signature: '', key: '', photo: null, path: null })
  const router = useRouter()
  const checks = inspectionCurrent(state, stay) ? state!.checks : {}
  const progress = inspectionProgress(state, stay)
  function select(item: InspectionItem) { setActive(item); setResult('checked'); setNote(''); setPhoto(null); setPhotoLink(null); setMessage('') }
  function save() {
    if (!active || !canEdit || pending) return
    const input = { reservation_id: stay.id, property_id: stay.property_id, stay_check_in: stay.check_in, stay_check_out: stay.check_out,
      item: active, result, note: note.trim(), expected_version: state?.version ?? 0 }
    const signature = JSON.stringify(input)
    if (request.current.signature !== signature || request.current.photo !== photo) request.current = { signature, key: crypto.randomUUID(), photo, path: null }
    setMessage('')
    startTransition(async () => {
      try {
        if (photo && !request.current.path) {
          const form = new FormData(); form.set('reservation_id', stay.id); form.set('photo', photo)
          const upload = await uploadInspectionPhoto(form)
          if (!upload.path) { setMessage(upload.error ?? 'No se guardó la foto.'); return }
          request.current.path = upload.path
        }
        const response = await saveInspection({ ...input, photo_path: request.current.path, request_key: request.current.key })
        if (!response.ok) { setMessage(response.error ?? 'No se guardó. Actualiza antes de reintentar.'); return }
        if ('data' in response && response.data) setState(response.data)
        setMessage('Revisión registrada y releída. No confirma por sí sola que el apartamento esté listo.')
        setActive(null); setPhoto(null); setNote(''); router.refresh()
      } catch { setMessage('Resultado incierto. Actualiza antes de repetir; conserva este formulario para reintentar la misma operación.') }
    })
  }
  return <section className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-bold">Revisión física · {progress.checked}/{progress.total}</h2>
    <p className="text-sm text-slate-600">Marca únicamente lo que revisaste. Un problema queda en Mantenimiento para esta y las próximas llegadas hasta que se resuelva. No cambia fechas ni confirma «Listo».</p>
    {state && !inspectionCurrent(state, stay) ? <p role="alert" className="text-amber-900">La estancia cambió o hubo otra ocupación. El checklist anterior se conserva como historial, pero hay que revisar de nuevo.</p> : null}
    <ul className="divide-y">{INSPECTION_ITEMS.map(item => {
      const fact = checks[item.key]
      return <li key={item.key} className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{item.label}</h3>
          <span className="text-sm">{!fact ? 'Sin revisar' : fact.result === 'issue' ? '⚠ Problema reportado' : fact.result === 'not_applicable' ? 'No aplica, justificado' : '✓ Revisado'}</span></div>
        <p className="text-sm text-slate-600">{item.hint}</p>
        {fact ? <p className="mt-1 text-xs break-words">{fact.author} · {new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }).format(new Date(fact.at))} · Colombia{fact.note ? ` · ${fact.note}` : ''}</p> : null}
        {fact?.maintenance_id ? <p className="text-xs text-amber-900">La incidencia se gestiona en Mantenimiento; marcar revisado no la resuelve.</p> : null}
        <div className="flex flex-wrap gap-2">{canEdit ? <button disabled={pending} onClick={() => select(item.key)} className="min-h-11 rounded border px-3 text-sm disabled:opacity-50">{fact ? 'Registrar nueva revisión' : 'Revisar este punto'}</button> : null}
          {fact?.photo_path ? <button disabled={pending} className="min-h-11 underline text-sm" onClick={() => startTransition(async () => {
            const response = await inspectionPhotoUrl(stay.id,item.key)
            setPhotoLink(response.url ?? null); setMessage(response.error ?? 'Enlace privado válido durante dos minutos.')
          })}>Ver foto privada</button> : null}</div>
      </li>
    })}</ul>
    {!canEdit ? <p className="text-sm text-amber-900">Solo se registra el día anterior o el día de llegada, para una reserva confirmada.</p> : null}
    {active ? <fieldset disabled={pending} className="space-y-3 rounded-lg border p-3">
      <legend className="font-semibold">{INSPECTION_ITEMS.find(i => i.key === active)?.label}</legend>
      <label className="block">Resultado<select value={result} onChange={e => setResult(e.target.value as InspectionResult)} className="mt-1 min-h-11 w-full rounded border p-2">
        <option value="checked">Revisado, sin problema observado</option><option value="issue">Encontré un problema</option><option value="not_applicable">No aplica (explicar)</option>
      </select></label>
      <label className="block">Observación{result !== 'checked' ? ' (mínimo 10 caracteres)' : ' (opcional)'}<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} className="mt-1 min-h-20 w-full rounded border p-2" /></label>
      <label className="block">Foto privada opcional (máximo 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] ?? null)} className="mt-1 min-h-11 w-full text-sm" /></label>
      <p className="text-xs text-slate-600">Fotografía solo el elemento. Evita personas, documentos, contraseñas y datos de huéspedes.</p>
      <div className="flex gap-2"><button onClick={save} disabled={pending || (result !== 'checked' && note.trim().length < 10)} className="min-h-11 rounded bg-slate-900 px-3 text-white disabled:opacity-50">Registrar lo revisado</button>
        <button onClick={() => { setActive(null); setPhoto(null) }} className="min-h-11 px-3">Cancelar</button></div>
    </fieldset> : null}
    {message ? <p role="status" className="text-sm">{message} <button className="min-h-11 underline" onClick={() => router.refresh()}>Actualizar</button></p> : null}
    {photoLink ? <a href={photoLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">Abrir foto privada</a> : null}
  </section>
}
