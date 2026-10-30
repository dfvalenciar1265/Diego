import type { Db } from '@/lib/gpt-api/db'
import type { GmailIssue, GmailRun } from './types'
import { GMAIL_INTERVAL_MINUTES } from './config'

export type GmailRunSummary = Pick<GmailRun,'id'|'status'|'started_at'|'finished_at'|'lease_until'|'scope_from'|'scope_to'|'scan_complete'|'stats'|'error_code'>
export interface GmailStatus {
  connected: boolean
  available: boolean
  latest: GmailRunSummary | null
  lastRead: GmailRunSummary | null
  issues: GmailIssue[]
  pendingCount: number | null
  delayed: boolean
  interrupted: boolean
  intervalMinutes: number
}
const RUN_FIELDS='id,status,started_at,finished_at,lease_until,scope_from,scope_to,scan_complete,stats,error_code'
const empty = (): GmailStatus => ({ connected: false, available: false, latest: null, lastRead: null,
  issues: [], pendingCount: null, delayed: true, interrupted: false, intervalMinutes: GMAIL_INTERVAL_MINUTES })
export function readingDelayed(lastRead: GmailRunSummary | null, now: number): boolean {
  const end = lastRead ? Date.parse(lastRead.scope_to) : NaN
  return !Number.isFinite(end) || end>now+60_000 || now-end>(2*GMAIL_INTERVAL_MINUTES+15)*60_000
}
export async function readGmailStatus(db: Db, now=Date.now()): Promise<GmailStatus> {
  const result=empty()
  const { data: settings, error } = await db.from('app_settings').select('value,updated_at').eq('key','gmail_refresh_token').maybeSingle()
  if (error) return result
  result.connected=Boolean(settings?.value)
  const connection=settings?.updated_at
  if (!connection) return { ...result, available: true }
  const [latest,lastRead,issues,count]=await Promise.all([
    db.from('gmail_sync_runs').select(RUN_FIELDS).eq('connection_version',connection).order('started_at',{ascending:false}).limit(1).maybeSingle(),
    db.from('gmail_sync_runs').select(RUN_FIELDS).eq('connection_version',connection).eq('scan_complete',true).order('scope_to',{ascending:false}).limit(1).maybeSingle(),
    db.from('gmail_sync_events').select('id,kind,code,reservation_id,source_at,status,reason,version').eq('connection_version',connection)
      .in('status',['conflict','error']).order('created_at',{ascending:false}).limit(30),
    db.from('gmail_sync_events').select('id',{count:'exact',head:true}).eq('connection_version',connection).in('status',['conflict','error']),
  ])
  if (latest.error||lastRead.error||issues.error||count.error) return result
  result.available=true
  // Proyección explícita: jamás devolver payload, cursor de paginación ni credenciales al navegador.
  const project=(value: Record<string,unknown> | null): GmailRunSummary | null => value ? Object.fromEntries(
    RUN_FIELDS.split(',').map(key=>[key,value[key]])) as unknown as GmailRunSummary : null
  result.latest=project(latest.data)
  result.lastRead=project(lastRead.data)
  result.pendingCount=count.count ?? null
  result.issues=(issues.data??[]).map(e=>({ id:e.id,kind:e.kind,code:e.code,reservation_id:e.reservation_id,
    source_at:e.source_at,status:e.status,reason:e.reason,version:e.version }))
  result.delayed=readingDelayed(result.lastRead,now)
  result.interrupted=result.latest?.status==='running' && Date.parse(result.latest.lease_until)<=now
  return result
}
export const GMAIL_REASON_LABELS: Record<string,string> = {
  unparsed_message:'El correo no se pudo interpretar con certeza.', missing_code:'Falta el código de reserva.',
  reservation_differs:'El correo contradice fechas, apartamento, huéspedes o monto de la app. Se conserva la app.',
  manual_change_after_email:'Hay un ajuste manual posterior al correo. Se conserva la app.',
  cancellation_without_reservation:'Llegó una cancelación explícita de una reserva que no figura en la app.',
  reservation_not_found:'No se encontró la reserva del correo.', change_details_missing:'Llegó una actualización sin los detalles del cambio.',
  stay_overlap:'Las fechas coinciden con otra reserva o bloqueo. Se requiere revisión.',
  property_not_found:'No se pudo identificar el apartamento.', ambiguous_stay:'No se puede identificar una única estancia.',
  database_write_failed:'No se confirmó la escritura. El mensaje queda para reintentar.', concurrent_reservation:'Otra operación registró la reserva; requiere revisión.',
}
