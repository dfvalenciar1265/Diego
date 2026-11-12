import type {Db} from '@/lib/gpt-api/db'
export function directContactInput(form:FormData):{phone:string;version:number;key:string}|{error:string}|null{
 if(!form.has('guest_phone'))return null
 if(form.get('source')!=='direct')return {error:'El teléfono privado solo se registra en una reserva directa.'}
 const raw=String(form.get('guest_phone')??'').trim()
 const phone=raw.replace(/[ ()-]/g,'')
 if(phone&&!/^\+[1-9]\d{6,14}$/.test(phone))return {error:'Escribe el teléfono con + y código de país (7 a 15 dígitos), o déjalo vacío.'}
 const version=Number(form.get('contact_version')),key=String(form.get('contact_request_key')??'')
 if(!Number.isInteger(version)||version<0||!key||key.length>200)return {error:'No se cargó la versión del contacto. Cierra y vuelve a abrir la reserva.'}
 return {phone,version,key}
}
export async function persistDirectContact(db:Db,id:string,input:ReturnType<typeof directContactInput>):Promise<string|undefined>{
 if(!input||'error'in input)return undefined
 const fail=`La reserva ${id} quedó guardada, pero el teléfono no se confirmó. No crees otra reserva: abre esta misma en Editar y revisa el contacto.`
 try {
 const {data,error}=await db.rpc('save_direct_reservation_contact',{p_reservation_id:id,p_phone:input.phone,p_expected_version:input.version,p_request_key:input.key})
 if(error||!data?.ok||!data.data)return fail
 const read=await db.from('direct_reservation_contacts').select('phone,version,updated_by,updated_at').eq('reservation_id',id).maybeSingle()
 if(read.error||read.data?.phone!==input.phone||read.data?.version!==data.data.version||read.data?.updated_by!==data.data.updated_by||read.data?.updated_at!==data.data.updated_at)return fail
 } catch {return fail}
}
