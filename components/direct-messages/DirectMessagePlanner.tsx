'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDirectDraft } from '@/actions/direct-messages'
import { DIRECT_LABELS, DIRECT_STAGES, directPlanBlockers, directSnapshot, suggestedDirectDate, type DirectChannel, type DirectDraft, type DirectPlanView, type DirectStage } from '@/lib/direct-messages'
function localColombia(iso: string | null | undefined) { return iso ? new Date(Date.parse(iso) - 5 * 3600000).toISOString().slice(0,16) : '' }
function DraftEditor({ view, stage, draft }: { view: DirectPlanView; stage: DirectStage; draft?: DirectDraft }) {
 const router = useRouter()
 const [channel,setChannel] = useState<DirectChannel>(draft?.channel ?? 'pending')
 const [recipient,setRecipient] = useState(draft?.recipient ?? '')
 const [body,setBody] = useState(draft?.body ?? '')
 const [scheduled,setScheduled] = useState(localColombia(draft?.scheduled_for))
 const [reviewed,setReviewed] = useState(false)
 const [busy,setBusy] = useState(false)
 const [notice,setNotice] = useState('')
 const attempt = useRef<{ signature: string; key: string } | null>(null)
 const inFlight = useRef(false)
 const blockers = directPlanBlockers(view.reservation)
 const suggestion = suggestedDirectDate(view.reservation,stage)
 async function save() {
  if (inFlight.current) return
  inFlight.current=true;setBusy(true);setNotice('')
  const input = { reservation_id:view.reservation.id,stage,snapshot:directSnapshot(view.reservation),expected_version:draft?.version ?? 0,
   channel,recipient,body,scheduled_for:scheduled ? `${scheduled}:00-05:00` : null,reviewed:true as const }
  const signature=JSON.stringify(input)
  if (attempt.current?.signature!==signature) attempt.current={signature,key:crypto.randomUUID()}
  try {
   const result=await saveDirectDraft({...input,request_key:attempt.current!.key})
   if (result.ok) { setNotice('Borrador guardado. No se enviará automáticamente.');setReviewed(false);router.refresh() }
   else setNotice(result.error)
  } catch { setNotice('No se confirmó el guardado. Recarga y comprueba antes de reintentar; no se ha enviado ningún mensaje.') }
  finally {inFlight.current=false;setBusy(false)}
 }
 return <details className="rounded-xl border border-slate-200 p-3">
  <summary className="cursor-pointer font-semibold">{DIRECT_LABELS[stage]} · {draft ? draft.status==='draft'?'Borrador guardado':draft.status==='cancelled'?'Cancelado':'Revisar cambios':'Sin planificar'}</summary>
  <div className="mt-3 space-y-3 text-sm">
   {draft?.review_reason && <p role="alert" className="rounded bg-amber-50 p-2">{draft.review_reason}</p>}
   {blockers.map(b=><p key={b} role="alert" className="text-red-700">{b}</p>)}
   <p className="text-slate-600">{suggestion ? `Fecha sugerida: ${suggestion}. Elige una hora de Colombia.`:'Elige cuándo revisar la confirmación.'} La fecha pasada no provoca envíos retroactivos.</p>
   <label className="block">Fecha y hora propuestas (Colombia)<input aria-label={`Fecha ${DIRECT_LABELS[stage]}`} type="datetime-local" value={scheduled} onChange={e=>setScheduled(e.target.value)} className="block w-full rounded border p-2" /></label>
   <label className="block">Canal<select value={channel} onChange={e=>setChannel(e.target.value as DirectChannel)} className="block w-full rounded border p-2"><option value="pending">Pendiente de definir</option><option value="whatsapp">WhatsApp</option><option value="email">Correo</option></select></label>
   <label className="block">Contacto a comprobar<input maxLength={200} value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="No se toma del nombre del huésped" className="block w-full rounded border p-2" /></label>
   <label className="block">Texto por revisar<textarea maxLength={4000} rows={5} value={body} onChange={e=>setBody(e.target.value)} className="block w-full rounded border p-2" /></label>
   <p className="text-xs text-slate-600">Sin plantilla aprobada automática. Revisa las instrucciones del apartamento. No incluyas documentos, datos de menores, claves ni información sensible. Guardar no verifica el contacto ni autoriza un envío.</p>
   <label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />Revisé las fechas y el contenido de este borrador.</label>
   <button type="button" disabled={busy || !reviewed || blockers.length>0} onClick={save} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">{busy?'Guardando…':'Guardar borrador'}</button>
   {notice && <p role="status">{notice}</p>}
  </div>
 </details>
}
export function DirectMessagePlanner({ views }: { views: DirectPlanView[] }) {
 return <div className="space-y-4">{views.map(view=><section key={view.reservation.id} className="rounded-xl border bg-white p-4">
  <h2 className="font-bold">{view.apartment} · {view.reservation.guest_name}</h2>
  <p className="mb-3 text-sm text-slate-600">{view.reservation.check_in} a {view.reservation.check_out} · {view.reservation.guests ?? 'Sin confirmar'} huéspedes</p>
  <div className="space-y-2">{DIRECT_STAGES.map(stage=>{const draft=view.drafts.find(d=>d.stage===stage);return <DraftEditor key={`${stage}:${draft?.version ?? 0}`} view={view} stage={stage} draft={draft} />})}</div>
 </section>)}</div>
}
