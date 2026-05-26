'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canDo } from '@/lib/permissions'
import type { Reservation } from '@/lib/types'

async function getCallerRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('id', user.id)
    .single()
  return data?.role ?? null
}

export async function getReservations(month?: string): Promise<Reservation[]> {
  const supabase = await createClient()
  let query = supabase.from('reservations').select('*').order('check_in')
  if (month) {
    query = query
      .gte('check_in', `${month}-01`)
      .lt('check_out', `${month}-32`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createReservation(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role as 'admin' | 'cleaning' | 'maintenance', 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('reservations').insert({
    property_id: formData.get('property_id') as string,
    source: formData.get('source') as string,
    guest_name: formData.get('guest_name') as string,
    check_in: formData.get('check_in') as string,
    check_out: formData.get('check_out') as string,
    amount: Number(formData.get('amount')) || 0,
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
  if (!role || !canDo(role as 'admin' | 'cleaning' | 'maintenance', 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('reservations').update({
    guest_name: formData.get('guest_name') as string,
    check_in: formData.get('check_in') as string,
    check_out: formData.get('check_out') as string,
    amount: Number(formData.get('amount')) || 0,
    notes: formData.get('notes') as string,
    source: formData.get('source') as string,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/calendar')
  revalidatePath('/')
  return { success: true }
}

export async function deleteReservation(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('reservations').delete().eq('id', id)
  revalidatePath('/calendar')
  revalidatePath('/')
}
