'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPreventiveReview } from '@/actions/preventive-review'
import type { PreventiveReviewParent, PreventiveReview } from '@/lib/preventive-review'
type Data={parents:PreventiveReviewParent[];reviews:PreventiveReview[];correctives:PreventiveReviewParent[]}
function ReviewCard({parent,reviews,correctives,propertyName}:{propertyName?:string;parent:PreventiveReviewParent;reviews:PreventiveReview[];correctives:PreventiveReviewParent[]}){
 const router=useRouter()
 const [disposition,setDisposition]=useState('')
 const [reference,setReference]=useState('')
 const [reason,setReason]=useState('')
 const [correctiveId,setCorrectiveId]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const flight=useRef(false),request=useRef({signature:'',key:''})
 const targets=correctives.filter(c=>c.property_id===parent.property_id&&c.id!==parent.id)
 async function save(){
  if(flight.current||!confirmed)return
  const corrective=disposition==='link_existing'?targets.find(c=>c.id===correctiveId):null
  const input={parent_id:parent.id,parent_snapshot:parent,source_reference:reference.trim(),disposition,reason:reason.trim(),corrective_id:corrective?.id??null,corrective_snapshot:corrective??null,expected_version:0,confirmed:true}
  const signature=JSON.stringify(input)
  if(request.current.signature!==signature)request.current={signature,key:crypto.randomUUID()}
  flight.current=true;setBusy(true);setMessage('')
  try{const result=await recordPreventiveReview({...input,request_key:request.current.key});if(!result.ok){setMessage(result.error);return}setMessage('Revisión registrada y verificada. El preventivo conserva su programación y estado.');setConfirmed(false);router.refresh()}
  catch{setMessage('Resultado incierto. Actualiza y comprueba antes de repetir; conserva la misma referencia.')}
  finally{flight.current=false;setBusy(false)}
 }
 return <article className="space-y-3 rounded-xl border p-4">
  <h2 className="font-bold">{String(parent.title)}</h2><p className="text-sm">Apartamento: {propertyName || 'Nombre no disponible'}</p>
  <details><summary className="min-h-11 cursor-pointer py-3">Leer notas y descripción originales · solo contexto</summary><div className="space-y-2 whitespace-pre-wrap break-words text-sm"><p>{String(parent.description||'Sin descripción')}</p><p>{String(parent.notes||'Sin notas')}</p></div></details>
  <p className="text-sm">No se convierte automáticamente ninguna nota en pendiente. Conserva la referencia del fragmento revisado, sin copiar información privada.</p>
  {reviews.length>0?<details><summary className="min-h-11 cursor-pointer py-3">Revisiones registradas ({reviews.length})</summary>{reviews.map(review=><p key={review.id} className="mb-2 break-words text-sm">{review.disposition==='create_report'?'Reporte pendiente de comprobar':review.disposition==='link_existing'?'Correctivo vinculado':'Sin acción'} · {review.source_reference} · {review.author} · {new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',dateStyle:'short',timeStyle:'short'}).format(new Date(review.recorded_at))} Colombia · {review.reason}</p>)}</details>:null}
  <fieldset disabled={busy} className="space-y-3">
   <label className="block">Referencia del fragmento revisado<input maxLength={200} value={reference} onChange={e=>{setReference(e.target.value);setConfirmed(false)}} className="min-h-11 w-full rounded border p-2"/></label>
   <label className="block">Decisión de esta revisión<select value={disposition} onChange={e=>{setDisposition(e.target.value);setCorrectiveId('');setConfirmed(false)}} className="min-h-11 w-full rounded border p-2"><option value="">Elige después de leer</option><option value="create_report">Crear reporte pendiente de comprobar</option><option value="link_existing">Vincular correctivo existente</option><option value="no_action">Sin acción, registrar motivo</option></select></label>
   {disposition==='link_existing'?<label className="block">Correctivo del mismo apartamento<select value={correctiveId} onChange={e=>{setCorrectiveId(e.target.value);setConfirmed(false)}} className="min-h-11 w-full rounded border p-2"><option value="">Selecciona el correctivo comprobado</option>{targets.map(c=><option key={c.id} value={c.id}>{String(c.title)} · {String(c.status)}</option>)}</select></label>:null}
   {disposition==='create_report'?<p className="text-amber-900">Se crea un reporte por comprobar, no un diagnóstico confirmado ni una reparación realizada.</p>:null}
   <label className="block">Motivo y comprobación de la decisión<textarea maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false)}} className="min-h-24 w-full rounded border p-2"/></label>
   <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Leí el contexto y comprobé esta decisión y su relación con el preventivo.</label>
   <button type="button" onClick={save} disabled={busy||!confirmed||!disposition||reference.trim().length<3||reason.trim().length<10||(disposition==='link_existing'&&!correctiveId)} className="min-h-11 rounded border px-3 disabled:opacity-50">Guardar revisión manual</button>
   {message?<p role="status">{message}</p>:null}
  </fieldset>
 </article>
}
export function PreventiveReviewPanel({data,propertyNames={}}:{data:Data;propertyNames?:Record<string,string>}){return <div className="space-y-4">{!data.parents.length?<p>No hay preventivos disponibles para revisión.</p>:data.parents.map(parent=><ReviewCard key={parent.id} propertyName={propertyNames[parent.property_id]} parent={parent} reviews={data.reviews.filter(r=>r.parent_id===parent.id)} correctives={data.correctives}/>)}</div>}
