import {createHash} from 'node:crypto'
import {redirect} from 'next/navigation'
import Link from 'next/link'
import {getCurrentMember} from '@/lib/auth'
import {createClient} from '@/lib/supabase/server'
import {CheckoutCheckSelector} from '@/components/dashboard/CheckoutCheckSelector'
export default async function Page(){
 const member=await getCurrentMember();if(member?.role!=='admin')redirect('/maintenance')
 const db=await createClient();const {data,error}=await db.from('maintenance').select('id,property_id,title,status,priority,description,notes').neq('priority','scheduled').neq('status','resolved').order('title')
 return <section className="space-y-4 p-4"><Link href="/maintenance">Volver a mantenimiento</Link><h1 className="text-xl font-bold">Comprobaciones opcionales al salir</h1><p>Selecciona un reporte existente y escribe qué comprobar. No se interpretan notas ni se inventan cantidades. No marca limpieza ni resuelve mantenimiento.</p>{error?<p role="alert">No se pudieron consultar los reportes.</p>:<CheckoutCheckSelector sources={(data??[]).map(({description,notes,...source})=>({...source,fingerprint:createHash('md5').update((description??'')+'\x1f'+(notes??'')).digest('hex')}))}/>}</section>
}
