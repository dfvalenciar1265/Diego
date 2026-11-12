'use client'
import {useRef,useState} from 'react'
import {selectCheckoutCheck} from '@/actions/checkout-checks'
import type {CheckSource} from '@/lib/checkout-checks'
export function CheckoutCheckSelector({sources}:{sources:CheckSource[]}){
 const [id,setId]=useState(''),[instruction,setInstruction]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);const req=useRef({sig:'',key:''})
 async function save(){const source=sources.find(s=>s.id===id);if(!source||busy)return;const sig=JSON.stringify({source,instruction});if(req.current.sig!==sig)req.current={sig,key:crypto.randomUUID()};setBusy(true);try{const r=await selectCheckoutCheck(source,instruction,req.current.key);setMessage(r.ok?'Aviso opcional guardado y verificado. No se modificó el reporte.':r.error??'No se guardó.')}catch{setMessage('Resultado incierto. Actualiza antes de repetir.')}finally{setBusy(false)}}
 return <fieldset disabled={busy} className="space-y-3"><label className="block">Reporte que necesita comprobación<select value={id} onChange={e=>setId(e.target.value)} className="min-h-11 w-full border p-2"><option value="">Seleccionar explícitamente</option>{sources.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label><label className="block">Qué comprobar al salir<textarea value={instruction} onChange={e=>setInstruction(e.target.value)} maxLength={500} className="min-h-24 w-full border p-2"/></label><p className="text-sm">Por ejemplo: contar los platos disponibles. Incluye cantidades solo si están comprobadas en la fuente.</p><button onClick={save} disabled={busy||!id||instruction.trim().length<10} className="min-h-11 rounded border p-2">Activar aviso opcional</button>{message?<p role="status">{message}</p>:null}</fieldset>
}
