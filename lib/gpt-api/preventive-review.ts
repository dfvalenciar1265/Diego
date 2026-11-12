import { z } from 'zod'
import type { Db } from './db'
import type { Actor } from './followups'
import type { ServiceResult } from './service'
import type { PreventiveReview,PreventiveReviewParent } from '@/lib/preventive-review'
const snapshot=z.record(z.string(),z.unknown())
export const preventiveReviewSchema=z.object({parent_id:z.string().uuid(),parent_snapshot:snapshot,source_reference:z.string().trim().min(3).max(200),disposition:z.enum(['create_report','link_existing','no_action']),reason:z.string().trim().min(10).max(1000),corrective_id:z.string().uuid().nullable(),corrective_snapshot:snapshot.nullable(),expected_version:z.literal(0),request_key:z.string().trim().min(1).max(200),confirmed:z.literal(true)}).strict().refine(v=>v.disposition==='link_existing'?Boolean(v.corrective_id&&v.corrective_snapshot):v.corrective_id===null&&v.corrective_snapshot===null)
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
 return JSON.stringify(value) ?? 'undefined'
}
async function admin(db:Db,actor:Actor|null){if(!actor)return false;const r=await db.from('team_members').select('id,role,active').eq('id',actor.id).maybeSingle();return !r.error&&r.data?.active===true&&r.data.role==='admin'}
export async function listPreventiveReviews(db:Db,actor:Actor|null,parentId?:string):Promise<ServiceResult<{parents:PreventiveReviewParent[];reviews:PreventiveReview[];correctives:PreventiveReviewParent[]}>>{
 if(!await admin(db,actor))return {ok:false,status:403,error:'Se requiere un administrador activo.'}
 if(parentId&&!z.string().uuid().safeParse(parentId).success)return {ok:false,status:400,error:'Preventivo inválido.'}
 let query=db.from('maintenance').select('*').eq('priority','scheduled').order('created_at',{ascending:false}).limit(201)
 if(parentId)query=query.eq('id',parentId)
 const parents=await query
 if(parents.error||(parents.data?.length??0)>200)return {ok:false,status:503,error:'No se pudo leer el conjunto completo de preventivos. No se tomó ninguna decisión.'}
 if(!parents.data?.length)return {ok:true,status:200,data:{parents:[],reviews:[],correctives:[]}}
 const [reviews,correctives]=await Promise.all([db.from('preventive_note_reviews').select('*').in('parent_id',parents.data.map(p=>p.id)).order('recorded_at',{ascending:false}).limit(1001),db.from('maintenance').select('*').in('property_id',[...new Set(parents.data.map(p=>p.property_id))]).neq('priority','scheduled').in('status',['open','in_progress']).order('created_at',{ascending:false}).limit(501)])
 if(reviews.error||correctives.error||(reviews.data?.length??0)>1000||(correctives.data?.length??0)>500)return {ok:false,status:503,error:'No se pudo releer historial y correctivos completos. Puede faltar la migración local.'}
 return {ok:true,status:200,data:{parents:parents.data as PreventiveReviewParent[],reviews:(reviews.data??[]) as PreventiveReview[],correctives:(correctives.data??[]) as PreventiveReviewParent[]}}
}
export async function savePreventiveReview(db:Db,actor:Actor|null,input:unknown):Promise<ServiceResult<PreventiveReview>>{
 if(!await admin(db,actor))return {ok:false,status:403,error:'Se requiere un administrador activo.'}
 const parsed=preventiveReviewSchema.safeParse(input)
 if(!parsed.success)return {ok:false,status:400,error:'Relee las notas y confirma fuente, motivo y decisión explícita.'}
 const result=await db.rpc('save_preventive_note_review',{p_input:parsed.data,p_source:actor!.via,p_actor_id:actor!.id})
 if(result.error||!result.data||typeof result.data.ok!=='boolean')return {ok:false,status:503,error:'Resultado incierto. Conserva la referencia y clave; relee antes de repetir.'}
 if(!result.data.ok)return {ok:false,status:result.data.conflict?409:400,error:result.data.error,current:result.data.current}
 const saved=result.data.data
 if(!saved?.id)return {ok:false,status:503,error:'No se confirmó el registro. Relee antes de repetir.'}
 const read=await db.from('preventive_note_reviews').select('*').eq('id',saved.id).maybeSingle()
 const fields=['version','parent_id','source_reference','disposition','reason','parent_snapshot','corrective_id','corrective_snapshot','report_state','actor_id','author','recorded_at']
 const outcomeValid=read.data&&(parsed.data.disposition==='no_action'?(read.data.corrective_id===null&&read.data.corrective_snapshot===null&&read.data.report_state===null):Boolean(read.data.corrective_id&&read.data.corrective_snapshot&&(parsed.data.disposition!=='create_report'||read.data.report_state==='pending_verification')))
 const matchesInput=read.data&&read.data.parent_id===parsed.data.parent_id&&read.data.source_reference===parsed.data.source_reference&&read.data.disposition===parsed.data.disposition&&read.data.reason===parsed.data.reason&&canonical(read.data.parent_snapshot)===canonical(parsed.data.parent_snapshot)&&(parsed.data.disposition!=='link_existing'||(read.data.corrective_id===parsed.data.corrective_id&&canonical(read.data.corrective_snapshot)===canonical(parsed.data.corrective_snapshot)))
 if(read.error||!read.data||!matchesInput||!outcomeValid||fields.some(field=>canonical(read.data![field])!==canonical(saved[field])))return {ok:false,status:503,error:'No se pudo verificar la revisión guardada. No repitas con otra referencia.'}
 return {ok:true,status:200,data:read.data as PreventiveReview}
}
