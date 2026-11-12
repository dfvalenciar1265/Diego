'use client'
import {useEffect,useRef,useState} from 'react'
import {loadCheckoutChecks,omitCheckoutCheck} from '@/actions/checkout-checks'
import type {CheckStay,checkoutPrompts} from '@/lib/checkout-checks'
function CheckoutOptionalChecksState({stay,canOmit}:{stay:CheckStay;canOmit:boolean}){
 const [items,setItems]=useState<ReturnType<typeof checkoutPrompts>>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reasons,setReasons]=useState<Record<string,string>>({});const req=useRef<Record<string,{sig:string;key:string}>>({})
 useEffect(()=>{let alive=true;loadCheckoutChecks(stay).then(r=>{if(alive){setItems(r.items??[]);setError(r.error??'')}}).catch(()=>{if(alive)setError('No se pudieron comprobar los avisos opcionales. La limpieza puede continuar.')});return()=>{alive=false}},[stay.id,stay.property_id,stay.check_in,stay.check_out]) // eslint-disable-line react-hooks/exhaustive-deps
 async function omit(item:typeof items[number]){const reason=reasons[item.id]??'';if(busy||reason.trim().length<3)return;const sig=JSON.stringify({stay,source:item.source,reason});if(req.current[item.id]?.sig!==sig)req.current[item.id]={sig,key:crypto.randomUUID()};setBusy(true);try{const result=await omitCheckoutCheck(item.id,stay,item.source,reason,req.current[item.id].key);if(!result.ok){setError(result.error??'No se guardó.');return}const read=await loadCheckoutChecks(stay);setItems(read.items??[]);setError(read.error??'')}catch{setError('Resultado incierto. Actualiza antes de repetir.')}finally{setBusy(false)}}
 const visible=items.filter(item=>!item.skipped)
 if(!visible.length&&!error)return null
 return <section className="mt-2 space-y-2 rounded border p-2"><h3 className="text-sm font-semibold">Comprobaciones opcionales</h3>{visible.map(item=><div key={item.id} className="text-sm"><p>{item.instruction}</p><p className="text-xs">Reporte: {item.source.title}</p>{item.stale?<p role="alert">El reporte cambió. Administración debe revisar este aviso.</p>:canOmit?<div><label>Motivo para omitir<input value={reasons[item.id]??''} onChange={e=>setReasons({...reasons,[item.id]:e.target.value})} maxLength={500} className="min-h-11 w-full border p-2"/></label><button disabled={busy||(reasons[item.id]??'').trim().length<3} onClick={()=>omit(item)} className="min-h-11 underline">Omitir solo esta salida</button></div>:null}</div>)}<p className="text-xs">No bloquea limpieza ni confirma inventario. Omitir no resuelve mantenimiento.</p>{error?<p role="alert">{error}</p>:null}</section>
}

export function CheckoutOptionalChecks({stay,canOmit}:{stay:CheckStay;canOmit:boolean}) {return <CheckoutOptionalChecksState key={JSON.stringify(stay)} stay={stay} canOmit={canOmit}/> }
