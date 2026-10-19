'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { addDays, todayInBogota } from '@/lib/gpt-api/dates'
import type { Db } from '@/lib/gpt-api/db'
import { findCharge, findRequest, parseChargePatch, parseRequestPatch, updateCharge, updateRequest } from '@/lib/gpt-api/followups'
import { createClient } from '@/lib/supabase/server'

/** Cobro adicional pendiente (no es ingreso recibido), tal como lo muestra la portada. */
export interface DueCharge {
  id: string
  reservation_id: string
  concept: string
  amount: number
  due_date: string
  review_reason: string | null
  version: number
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
  version: number
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
      .select('id, reservation_id, concept, amount, due_date, review_reason, version, reservation:reservations!inner(guest_name, check_in, check_out, property:properties(name))')
      .eq('status', 'pending')
      .order('due_date')
      .limit(300),
    supabase.from('special_requests')
      .select('id, kind, description, status, due_at, review_reason, version, responsible:team_members!special_requests_responsible_id_fkey(name), reservation:reservations!inner(guest_name, check_in, check_out, property:properties(name))')
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

export type FollowupActionResult = { success: true } | { success: false; error: string }

const CHANGED = 'Alguien lo cambió hace un momento. Recarga la página y revisa antes de repetir.'

/** Marca un cobro adicional como cobrado: exige la referencia o comprobante. Solo administradores. */
export async function markChargeCollected(
  id: string, expectedVersion: number, confirmation: string, collectedOn?: string,
): Promise<FollowupActionResult> {
  const member = await getCurrentMember()
  if (!member || member.role !== 'admin') return { success: false, error: 'Solo un administrador marca cobros.' }
  const today = todayInBogota()
  const patch = parseChargePatch({
    id, expected_version: expectedVersion, status: 'collected', confirmation, collected_on: collectedOn || today,
  }, today)
  if (!patch.ok) return { success: false, error: patch.error }
  const db = (await createClient()) as unknown as Db
  const current = await findCharge(db, id)
  if (!current) return { success: false, error: 'Ese cobro ya no existe.' }
  const result = await updateCharge(db, patch.value, current, { id: member.id, via: 'app' }, today)
  if (result.kind === 'conflict') return { success: false, error: CHANGED }
  if (result.kind !== 'ok') return { success: false, error: result.kind === 'rejected' ? result.message : 'Ese cobro ya no existe.' }
  revalidatePath('/')
  return { success: true }
}

/**
 * Solicitud especial: "notified" = se avisó (a quién y por dónde); "ready" = quedó hecha y alguien
 * lo confirma. Cualquiera del equipo puede hacerlo; la base solo le deja cambiar eso.
 */
export async function advanceSpecialRequest(
  id: string, expectedVersion: number, status: 'notified' | 'ready', text: string,
): Promise<FollowupActionResult> {
  const member = await getCurrentMember()
  if (!member) return { success: false, error: 'Tu sesión expiró. Vuelve a entrar.' }
  const patch = parseRequestPatch({
    id, expected_version: expectedVersion, status,
    ...(status === 'notified' ? { notified_note: text } : { ready_confirmation: `${member.name}: ${text}` }),
  })
  if (!patch.ok) return { success: false, error: patch.error }
  const db = (await createClient()) as unknown as Db
  if (!(await findRequest(db, id))) return { success: false, error: 'Esa solicitud ya no existe.' }
  const result = await updateRequest(db, patch.value, { id: member.id, via: 'app' })
  if (result.kind === 'conflict') return { success: false, error: CHANGED }
  if (result.kind !== 'ok') return { success: false, error: result.kind === 'rejected' ? result.message : 'Esa solicitud ya no existe.' }
  revalidatePath('/')
  return { success: true }
}
