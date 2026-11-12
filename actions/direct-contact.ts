'use server'
import {getCurrentMember} from '@/lib/auth'
import {createClient} from '@/lib/supabase/server'
export async function getDirectReservationContact(id:string){
 const member=await getCurrentMember()
 if(!member||member.role!=='admin'||!member.active)return {ok:false as const,error:'No autorizado'}
 const db=await createClient()
 const r=await db.from('reservations').select('source').eq('id',id).maybeSingle()
 if(r.error||!r.data)return {ok:false as const,error:'No se pudo comprobar la reserva.'}
 const c=await db.from('direct_reservation_contacts').select('phone,version').eq('reservation_id',id).maybeSingle()
 if(c.error)return {ok:false as const,error:'No se pudo cargar el teléfono privado. Puedes guardar otros datos sin cambiarlo.'}
 return {ok:true as const,phone:r.data.source==='direct'?(c.data?.phone??''):'',version:c.data?.version??0}
}
