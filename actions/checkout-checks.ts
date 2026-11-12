'use server'
import {createHash} from 'node:crypto'
import {getCurrentMember} from '@/lib/auth'
import {createClient} from '@/lib/supabase/server'
import {revalidatePath} from 'next/cache'
import {isUuid} from '@/lib/gpt-api/validate'
import {checkoutPrompts,sameCheckSource,sameCheckStay,type CheckSource,type CheckStay,type CheckoutPrompt,type CheckoutSkip} from '@/lib/checkout-checks'
export async function loadCheckoutChecks(stay:CheckStay){
 const member=await getCurrentMember();if(!member||![stay.id,stay.property_id].every(isUuid))return {error:'No se pudieron consultar las revisiones opcionales.'}
 const db=await createClient();const [p,s,k]=await Promise.all([db.from('checkout_check_prompts').select('*').eq('property_id',stay.property_id).order('created_at',{ascending:false}).order('id'),db.from('maintenance').select('id,property_id,title,status,priority,description,notes').eq('property_id',stay.property_id).neq('priority','scheduled').neq('status','resolved'),db.from('checkout_check_skips').select('*').eq('reservation_id',stay.id)])
 if(p.error||s.error||k.error)return {error:'No se pudieron comprobar los avisos opcionales. La limpieza puede continuar.'}
 return {items:checkoutPrompts(p.data as CheckoutPrompt[],s.data.map(({description,notes,...source})=>({...source,fingerprint:createHash('md5').update((description??'')+'\x1f'+(notes??'')).digest('hex')})) as CheckSource[],k.data as CheckoutSkip[],stay)}
}
export async function selectCheckoutCheck(source:CheckSource,instruction:string,key:string){
 const member=await getCurrentMember();if(member?.role!=='admin')return {ok:false,error:'Solo administración selecciona estas comprobaciones.'}
 const db=await createClient();const {data,error}=await db.rpc('add_checkout_check',{p_source_id:source.id,p_snapshot:source,p_instruction:instruction,p_request_key:key})
 if(error||!data?.ok)return {ok:false,error:data?.error??'No se confirmó el aviso.'}
 const row=await db.from('checkout_check_prompts').select('id,instruction,source_snapshot').eq('id',data.id).single()
 if(row.error||!row.data||row.data.instruction!==instruction.trim()||!sameCheckSource(row.data.source_snapshot,source))return {ok:false,error:'Aceptado sin relectura comprobada. Actualiza antes de repetir.'}
 revalidatePath('/');return {ok:true}
}
export async function omitCheckoutCheck(promptId:string,stay:CheckStay,source:CheckSource,reason:string,key:string){
 const member=await getCurrentMember();if(!member||!['admin','anfitrion','cleaning'].includes(member.role))return {ok:false,error:'Sin permiso para esta salida.'}
 const db=await createClient();const {data,error}=await db.rpc('skip_checkout_check',{p_prompt_id:promptId,p_reservation_id:stay.id,p_stay:stay,p_source:source,p_reason:reason,p_request_key:key})
 if(error||!data?.ok)return {ok:false,error:data?.error??'No se confirmó la omisión.'}
 const row=await db.from('checkout_check_skips').select('prompt_id,reservation_id,source_snapshot,stay_snapshot,reason,actor_id,created_at').eq('id',data.id).single()
 if(row.error||row.data?.prompt_id!==promptId||row.data?.reservation_id!==stay.id||row.data.actor_id!==member.id||!row.data.created_at||row.data.reason!==reason.trim()||!sameCheckSource(row.data.source_snapshot,source)||!sameCheckStay(row.data.stay_snapshot,stay))return {ok:false,error:'Aceptado sin relectura comprobada. Actualiza antes de repetir.'}
 revalidatePath('/');return {ok:true}
}
