'use client'
import { useState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewGmailIssue } from '@/actions/gmail'
import { GMAIL_REASON_LABELS,type GmailStatus } from '@/lib/gmail-reconciliation/status'
import type { GmailIssue } from '@/lib/gmail-reconciliation/types'
const date=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('es-CO',{
  timeZone:'America/Bogota',dateStyle:'medium',timeStyle:'short',
}).format(new Date(value)):'Sin registro'
const states={running:'En curso',complete:'Completa',partial:'Parcial',failed:'Falló',interrupted:'Interrumpida'}
const kinds={confirmation:'Confirmación',update:'Actualización',cancellation:'Cancelación explícita',change_request:'Solicitud de cambio',unparsed:'Correo por identificar'}
function Issue({issue}:{issue:GmailIssue}) {
  const [note,setNote]=useState('')
  const [message,setMessage]=useState('')
  const [pending,startTransition]=useTransition()
  const router=useRouter()
  return <li className="rounded-xl border p-3 text-xs space-y-2">
    <p className="font-semibold">{kinds[issue.kind]} · {issue.code??'Sin código'}</p>
    <p>{GMAIL_REASON_LABELS[issue.reason]??'Requiere revisión del correo y de la reserva.'}</p>
    <p>Correo: {date(issue.source_at)} · {issue.status==='error'?'Error de aplicación':'Conflicto'}</p>
    {issue.reservation_id?<a className="underline" href="/calendar">Consultar la reserva en el calendario</a>:null}
    <label className="block">Constancia de revisión
      <input value={note} onChange={e=>setNote(e.target.value)} maxLength={500} className="mt-1 w-full rounded border p-2" />
    </label>
    <button disabled={pending||note.trim().length<3} className="rounded border p-2 disabled:opacity-50" onClick={()=>startTransition(async()=>{
      try {
        const result=await reviewGmailIssue(issue.id,issue.version,note)
        setMessage(result.success?'Revisión registrada; la reserva conserva sus datos.':result.error??'No se guardó.')
        if(result.success)router.refresh()
      }catch{setMessage('Resultado incierto. Actualiza antes de reintentar.')}
    })}>Registrar revisión sin cambiar la reserva</button>
    {message?<p role="status">{message}</p>:null}
  </li>
}
export function GmailReconciliation({status}:{status:GmailStatus}) {
  if(!status.available)return <div role="alert" className="rounded-xl border border-amber-300 p-4 text-sm">Conciliación no disponible. Se requiere completar la configuración del servidor; no se puede certificar la importación.</div>
  const run=status.latest
  return <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-3 text-sm">
    <h2 className="font-semibold">Conciliación de Gmail</h2>
    <p>Programación: cada {status.intervalMinutes} minutos · horas de Colombia</p>
    <p>Último intento: {date(run?.started_at)} · {run?states[run.status]:'Sin intentos'}</p>
    {status.interrupted?<p role="alert" className="text-red-700">La última corrida dejó de responder. La siguiente recuperará la lectura pendiente.</p>:null}
    <p>Última lectura completa: {date(status.lastRead?.scope_to)}</p>
    {status.delayed?<p role="alert" className="text-amber-800">Demora: no hay una lectura completa reciente. Esto no significa cancelación.</p>:null}
    {run?<div className="space-y-1">
      <p>Alcance del intento: {date(run.scope_from)} → {date(run.scope_to)}</p>
      <p>{run.scan_complete?'Se terminó de leer ese alcance.':'Queda correo por leer; la próxima corrida continúa este alcance.'}</p>
      <p>Reservas nuevas: {run.stats.new_count??0} · cambios para revisar: {run.stats.updated_count??0} · cancelaciones aplicadas: {run.stats.cancelled_count??0}</p>
      {run.error_code?<p role="alert" className="text-red-700">El intento registró un error o trabajo incompleto. Los datos anteriores se conservan.</p>:null}
    </div>:null}
    <p className="font-medium">Pendientes de conciliación: {status.pendingCount??'Sin comprobar'}</p>
    <p className="text-xs text-[var(--text-muted)]">Conectar Gmail o encontrar cero reservas nuevas no certifica que todo esté al día. Las cancelaciones requieren un correo explícito con código.</p>
    <ul className="space-y-2">{status.issues.map(issue=><Issue key={`${issue.id}:${issue.version}`} issue={issue}/>)}</ul>
    {status.pendingCount!==null&&status.pendingCount>status.issues.length?<p>Se muestran los 30 pendientes más recientes. Los demás se conservan para revisión.</p>:null}
  </section>
}
