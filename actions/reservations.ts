'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canDo } from '@/lib/permissions'
import type { Reservation, UserRole } from '@/lib/types'

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
  const { error } = await supabase.from('reservations').insert({
    property_id: formData.get('property_id') as string,
    source: formData.get('source') as string,
    guest_name: formData.get('guest_name') as string,
    check_in: formData.get('check_in') as string,
    check_out: formData.get('check_out') as string,
    amount: Number(formData.get('amount')) || 0,
    guests: guestsRaw ? Math.max(1, parseInt(guestsRaw, 10)) : null,
    notes: formData.get('notes') as string,
    status: 'confirmed',
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/calendar')
  revalidatePath('/')
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
  const { error } = await supabase.from('reservations').update({
    guest_name: formData.get('guest_name') as string,
    check_in: formData.get('check_in') as string,
    check_out: formData.get('check_out') as string,
    amount: Number(formData.get('amount')) || 0,
    guests: guestsRaw ? Math.max(1, parseInt(guestsRaw, 10)) : null,
    notes: formData.get('notes') as string,
    source: formData.get('source') as string,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/calendar')
  revalidatePath('/')
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
