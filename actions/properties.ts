'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canDo } from '@/lib/permissions'
import type { Property } from '@/lib/types'

/** Obtiene el rol del usuario autenticado en el servidor */
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

export async function getProperties(onlyActive = false): Promise<Property[]> {
  const supabase = await createClient()
  let query = supabase.from('properties').select('*').order('name')
  if (onlyActive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getProperty(id: string): Promise<Property | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()
  // PGRST116 = "Row not found" — caso legítimo, retorna null
  if (error && error.code !== 'PGRST116') throw new Error(error.message)
  return data
}

export async function createProperty(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role as 'admin' | 'cleaning' | 'maintenance', 'properties:edit')) {
    return { success: false, error: 'No autorizado' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('properties').insert({
    name: formData.get('name') as string,
    address: formData.get('address') as string,
    access_code: formData.get('access_code') as string,
    instructions: formData.get('instructions') as string,
    capacity: Math.max(1, Number(formData.get('capacity')) || 1),
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  return { success: true }
}

/** Activates or hides a property (active=false hides it from the app). */
export async function togglePropertyActive(
  id: string,
  active: boolean
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role as 'admin' | 'cleaning' | 'maintenance' | 'anfitrion', 'properties:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('properties')
    .update({ active })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  revalidatePath('/')
  return { success: true }
}

export async function updateProperty(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role as 'admin' | 'cleaning' | 'maintenance', 'properties:edit')) {
    return { success: false, error: 'No autorizado' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('properties').update({
    name: formData.get('name') as string,
    address: formData.get('address') as string,
    access_code: formData.get('access_code') as string,
    instructions: formData.get('instructions') as string,
    capacity: Math.max(1, Number(formData.get('capacity')) || 1),
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  revalidatePath(`/properties/${id}`)
  return { success: true }
}
