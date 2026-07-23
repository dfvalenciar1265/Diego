'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canDo } from '@/lib/permissions'
import type { Reservation, UserRole } from '@/lib/types'

/** Day before a date (YYYY-MM-DD). */
function dayBefore(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function getCallerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('id', user.id)
    .single()
  return (data?.role as UserRole) ?? null
}

/**
 * Obtiene reservas. Sin filtro = todas. Con filtro 'YYYY-MM' incluye reservas
 * que se solapan con el mes (check_in < primer día del mes siguiente
 * y check_out >= primer día del mes).
 */
export async function getReservations(month?: string): Promise<Reservation[]> {
  const supabase = await createClient()
  let query = supabase
    .from('reservations')
    .select('*')
    .neq('status', 'cancelled')   // never show cancelled reservations
    .order('check_in')
  if (month) {
    const [year, mon] = month.split('-').map(Number)
    const nextMonthYear = mon === 12 ? year + 1 : year
    const nextMonth = `${nextMonthYear}-${String(mon === 12 ? 1 : mon + 1).padStart(2, '0')}-01`
    query = query
      .gte('check_out', `${month}-01`)
      .lt('check_in', nextMonth)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createReservation(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const guestsRaw = formData.get('guests') as string
  const propertyId = formData.get('property_id') as string
  const guestName  = formData.get('guest_name') as string
  const checkIn    = formData.get('check_in') as string
  const checkOut   = formData.get('check_out') as string
  const status     = (formData.get('status') as string) || 'confirmed'
  // Airbnb confirmation code — lets cancellation emails match this reservation later
  const airbnbCode = ((formData.get('airbnb_code') as string) || '').trim().toUpperCase() || null

  const { data: inserted, error } = await supabase.from('reservations').insert({
    property_id: propertyId,
    source: formData.get('source') as string,
    guest_name: guestName,
    check_in: checkIn,
    check_out: checkOut,
    amount: Number(formData.get('amount')) || 0,
    guests: guestsRaw ? Math.max(1, parseInt(guestsRaw, 10)) : null,
    notes: formData.get('notes') as string,
    airbnb_code: airbnbCode,
    status,
  }).select('id').single()
  if (error || !inserted) return { success: false, error: error?.message ?? 'Error al crear' }

  // Auto-create cleaning + preparation tasks (same as the Gmail sync does),
  // so manually-added reservations show up in Limpieza and Preparación.
  if (status === 'confirmed' && checkIn && checkOut) {
    const prepDate = dayBefore(checkIn) >= checkOut ? checkIn : dayBefore(checkIn)
    await supabase.from('tasks').insert([
      {
        property_id: propertyId,
        reservation_id: inserted.id,
        type: 'cleaning',
        scheduled_for: checkOut,
        status: 'pending',
        notes: `Limpieza post-estadía — ${guestName}`,
      },
      {
        property_id: propertyId,
        reservation_id: inserted.id,
        type: 'preparation',
        scheduled_for: prepDate,
        status: 'pending',
        notes: `Preparación para ${guestName} (check-in ${checkIn})`,
      },
    ])
  }

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  return { success: true }
}

export async function updateReservation(
  id: string, formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const guestsRaw = formData.get('guests') as string
  const airbnbCode = ((formData.get('airbnb_code') as string) || '').trim().toUpperCase() || null
  const checkIn  = formData.get('check_in') as string
  const checkOut = formData.get('check_out') as string
  const { error } = await supabase.from('reservations').update({
    guest_name: formData.get('guest_name') as string,
    check_in: checkIn,
    check_out: checkOut,
    amount: Number(formData.get('amount')) || 0,
    guests: guestsRaw ? Math.max(1, parseInt(guestsRaw, 10)) : null,
    notes: formData.get('notes') as string,
    source: formData.get('source') as string,
    airbnb_code: airbnbCode,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }

  // Keep the linked turnover tasks in sync with the (possibly edited) dates:
  // the cleaning is due on check-out, the preparation the day before check-in.
  // Without this, moving a reservation's dates strands its cleaning on the old
  // day — which, among other things, hides the check-out time editor on the home.
  if (checkOut) {
    await supabase.from('tasks').update({ scheduled_for: checkOut })
      .eq('reservation_id', id).eq('type', 'cleaning')
  }
  if (checkIn) {
    const prepDate = dayBefore(checkIn) >= checkOut ? checkIn : dayBefore(checkIn)
    await supabase.from('tasks').update({ scheduled_for: prepDate })
      .eq('reservation_id', id).eq('type', 'preparation')
  }

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  return { success: true }
}

/**
 * Reservations whose guest-requested change was accepted in Airbnb and is
 * waiting to be applied here (one tap). Ordered by check-in.
 */
export async function getAcceptedChanges(): Promise<Reservation[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('reservations')
    .select('*, property:properties(name)')
    .eq('status', 'confirmed')
    .not('pending_change', 'is', null)
    .order('check_in')
  // accepted_at lives inside the jsonb — filter in JS so the query stays simple
  return (data ?? []).filter(r => (r.pending_change as { accepted_at?: string | null } | null)?.accepted_at)
}

/** Applies the accepted change (guests and/or dates) and clears it. */
export async function applyReservationChange(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()

  const { data: res } = await supabase
    .from('reservations').select('id, check_in, check_out, guests, pending_change').eq('id', id).single()
  if (!res) return { success: false, error: 'Reserva no encontrada' }

  const pc = res.pending_change as {
    guests_to?: number | null; check_in_to?: string | null; check_out_to?: string | null
    accepted_at?: string | null
  } | null
  if (!pc?.accepted_at) return { success: false, error: 'Este cambio aún no fue aceptado en Airbnb' }

  const checkIn  = pc.check_in_to  ?? res.check_in
  const checkOut = pc.check_out_to ?? res.check_out
  const update: Record<string, unknown> = { pending_change: null }
  if (pc.guests_to != null)   update.guests    = pc.guests_to
  if (pc.check_in_to)         update.check_in  = checkIn
  if (pc.check_out_to)        update.check_out = checkOut

  const { error } = await supabase.from('reservations').update(update).eq('id', id)
  if (error) return { success: false, error: error.message }

  // Dates moved → keep the turnover tasks in sync (same rule as updateReservation)
  if (pc.check_in_to || pc.check_out_to) {
    await supabase.from('tasks').update({ scheduled_for: checkOut })
      .eq('reservation_id', id).eq('type', 'cleaning')
    const prepDate = dayBefore(checkIn) >= checkOut ? checkIn : dayBefore(checkIn)
    await supabase.from('tasks').update({ scheduled_for: prepDate })
      .eq('reservation_id', id).eq('type', 'preparation')
  }

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  return { success: true }
}

/** Dismisses the pending change without touching the reservation. */
export async function dismissReservationChange(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('reservations').update({ pending_change: null }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/')
  revalidatePath('/calendar')
  return { success: true }
}

export async function deleteReservation(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()

  // Fetch the reservation first to get guest_name and property_id for orphan cleanup
  const { data: reservation } = await supabase
    .from('reservations')
    .select('guest_name, property_id')
    .eq('id', id)
    .single()

  // Soft-delete: mark as cancelled instead of physically deleting.
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', id)
  if (error) return { success: false, error: error.message }

  // Delete ALL tasks linked to this reservation (any status — done tasks also removed)
  await supabase
    .from('tasks')
    .delete()
    .eq('reservation_id', id)

  // Also delete orphan tasks (reservation_id = null) for same property + guest name
  // These appear when auto-task creation runs before the reservation_id FK is set
  if (reservation?.guest_name && reservation?.property_id) {
    await supabase
      .from('tasks')
      .delete()
      .is('reservation_id', null)
      .eq('property_id', reservation.property_id)
      .ilike('notes', `%${reservation.guest_name}%`)
  }

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/tasks')
  return { success: true }
}
