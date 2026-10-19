'use server'
import { addDays, todayInBogota } from '@/lib/gpt-api/dates'
import { createClient } from '@/lib/supabase/server'

/** Cobro adicional pendiente (no es ingreso recibido), tal como lo muestra la portada. */
export interface DueCharge {
  id: string
  reservation_id: string
  concept: string
  amount: number
  due_date: string
  review_reason: string | null
  property_name: string
  guest_name: string
}

/** Solicitud especial (cuna, camas…) abierta o de una llegada de hoy. */
export interface OpenRequest {
  id: string
  kind: 'crib' | 'beds' | 'other'
  description: string
  status: 'registered' | 'notified' | 'ready' | 'cancelled'
  due_at: string
  review_reason: string | null
  property_name: string
  guest_name: string
  check_in: string
  responsible_name: string | null
}

type Embedded<T> = T | T[] | null
const one = <T,>(v: Embedded<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)

type ResEmbed = { guest_name: string; check_in: string; check_out: string; property: Embedded<{ name: string }> }

/**
 * Cobros pendientes vencidos, que vencen hoy o de reservas que salen hoy, y solicitudes abiertas que vencen
 * hasta mañana (o las de las llegadas de hoy). La RLS deja los cobros solo a los administradores.
 * Si las tablas aún no existen (migración sin aplicar), devuelve vacío: la portada no se cae.
 */
export async function getTodayFollowups(): Promise<{ charges: DueCharge[]; requests: OpenRequest[] }> {
  const supabase = await createClient()
  const today = todayInBogota()
  const limit = `${addDays(today, 2)}T00:00:00-05:00`

  const [chargesRes, requestsRes] = await Promise.all([
    supabase.from('reservation_charges')
      .select('id, reservation_id, concept, amount, due_date, review_reason, reservation:reservations!inner(guest_name, check_in, check_out, property:properties(name))')
      .eq('status', 'pending')
      .order('due_date')
      .limit(300),
    supabase.from('special_requests')
      .select('id, kind, description, status, due_at, review_reason, responsible:team_members!special_requests_responsible_id_fkey(name), reservation:reservations!inner(guest_name, check_in, check_out, property:properties(name))')
      .in('status', ['registered', 'notified', 'ready'])
      .lt('due_at', limit)
      .gte('reservation.check_out', today)
      .order('due_at'),
  ])
  for (const r of [chargesRes, requestsRes]) {
    if (r.error) console.error('[followups] no pude leer cobros/solicitudes', r.error.code, r.error.message)
  }

  type ChargeRaw = Omit<DueCharge, 'property_name' | 'guest_name'> & { reservation: Embedded<ResEmbed> }
  type RequestRaw = Omit<OpenRequest, 'property_name' | 'guest_name' | 'check_in' | 'responsible_name'> & {
    reservation: Embedded<ResEmbed>; responsible: Embedded<{ name: string }>
  }
  const charges: DueCharge[] = ((chargesRes.data ?? []) as unknown as ChargeRaw[])
    // Vencidos o de hoy, y los de quien sale hoy aunque venzan después: que no se olviden.
    .filter(c => c.due_date <= today || one(c.reservation)?.check_out === today)
    .map(({ reservation, ...c }) => {
      const r = one(reservation)
      return { ...c, amount: Number(c.amount), guest_name: r?.guest_name ?? '—', property_name: one(r?.property ?? null)?.name ?? '—' }
    })
  const requests = ((requestsRes.data ?? []) as unknown as RequestRaw[])
    .map(({ reservation, responsible, ...q }) => {
      const r = one(reservation)
      return {
        ...q,
        guest_name: r?.guest_name ?? '—',
        property_name: one(r?.property ?? null)?.name ?? '—',
        check_in: r?.check_in ?? '',
        responsible_name: one(responsible)?.name ?? null,
      }
    })
    // Las ya listas solo se muestran el día de la llegada, como confirmación.
    .filter(q => q.status !== 'ready' || q.check_in === today)
  return { charges, requests }
}
