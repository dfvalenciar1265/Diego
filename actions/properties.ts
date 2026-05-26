'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Property } from '@/lib/types'

export async function getProperties(): Promise<Property[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getProperty(id: string): Promise<Property | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()
  return data
}

export async function createProperty(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('properties').insert({
    name: formData.get('name') as string,
    address: formData.get('address') as string,
    access_code: formData.get('access_code') as string,
    instructions: formData.get('instructions') as string,
    capacity: Number(formData.get('capacity')) || 2,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  return { success: true }
}

export async function updateProperty(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('properties').update({
    name: formData.get('name') as string,
    address: formData.get('address') as string,
    access_code: formData.get('access_code') as string,
    instructions: formData.get('instructions') as string,
    capacity: Number(formData.get('capacity')) || 2,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  revalidatePath(`/properties/${id}`)
  return { success: true }
}
