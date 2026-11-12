import type { Db } from '@/lib/gpt-api/db'
import { addDays,todayInBogota } from '@/lib/gpt-api/dates'
/** Siempre mañana calendario en Colombia, no mañana relativo al panel nocturno. */
export async function directArrivalsTomorrow(db:Db,role:string,now=new Date()):Promise<{date:string;count:number}|null>{
 if(role!=='admin')return null
 const date=addDays(todayInBogota(now),1)
 const {data,error}=await db.from('reservations').select('id').eq('source','direct').eq('status','confirmed').eq('check_in',date).limit(201)
 if(error||!data?.length||data.length>200)return null
 return {date,count:data.length}
}
