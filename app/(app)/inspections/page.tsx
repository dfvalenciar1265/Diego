import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { addDays, todayInBogota } from '@/lib/gpt-api/dates'
import { isUuid } from '@/lib/gpt-api/validate'
import { readInspection } from '@/lib/gpt-api/inspection'
import { canInspect, inspectionWindow } from '@/lib/inspection'
import { InspectionChecklistPanel } from '@/components/inspection/InspectionChecklistPanel'
function propertyName(value: unknown) {
  const property = Array.isArray(value) ? value[0] : value
  return property && typeof property === 'object' && 'name' in property ? String(property.name) : 'Apartamento'
}
export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const member = await getCurrentMember()
  if (!member || !canInspect(member.role)) redirect('/logout')
  const db = await createClient()
  const id = (await searchParams).reservation
  const today = todayInBogota()
  if (!id) {
    const { data, error } = await db.from('reservations').select('id,guest_name,check_in,property:properties(name)').eq('status','confirmed').gte('check_in',today).lte('check_in',addDays(today,1)).order('check_in')
    return <section className="space-y-4 p-4"><Link href="/" className="inline-flex min-h-11 items-center underline">Volver a Inicio</Link><h1 className="text-xl font-bold">Revisiones de llegadas</h1>
      {error ? <p role="alert">No se pudieron consultar las llegadas. No se da ninguna por revisada.</p> : !data?.length ? <p>No hay llegadas confirmadas hoy o mañana.</p> : <ul className="space-y-2">{data.map(r => <li key={r.id} className="rounded border bg-white p-3"><Link className="inline-flex min-h-11 items-center underline" href={`/inspections?reservation=${r.id}`}>{propertyName(r.property)} · {r.check_in} · {r.guest_name || 'Huésped'} · Revisar apartamento</Link></li>)}</ul>}</section>
  }
  if (!isUuid(id)) return <p role="alert" className="p-4">Reserva no válida.</p>
  const { data: stay, error } = await db.from('reservations').select('id,property_id,check_in,check_out,status,guest_name,property:properties(name)').eq('id',id).single()
  if (error || !stay) return <p role="alert" className="p-4">No se pudo comprobar la reserva.</p>
  const inspection = await readInspection(db,id)
  return <section className="space-y-4 p-4"><Link href="/" className="inline-flex min-h-11 items-center underline">Volver a Inicio</Link>
    <h1 className="text-xl font-bold">Checklist para recibir</h1><p>{propertyName(stay.property)} · {stay.guest_name} · {stay.check_in} a {stay.check_out}</p>
    {inspection.error ? <p role="alert">{inspection.error}</p> : <InspectionChecklistPanel key={`${id}:${inspection.state?.version ?? 0}`} stay={stay} initial={inspection.state} canEdit={inspectionWindow(stay,today)} />}</section>
}
