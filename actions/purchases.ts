'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PurchaseRequest } from '@/lib/types'

export async function getPurchaseRequests(
  status?: 'pending' | 'purchased'
): Promise<PurchaseRequest[]> {
  const supabase = await createClient()
  let query = supabase
    .from('purchase_requests')
    .select('*, property:properties(name), supply:supplies(name, unit)')
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data } = await query
  return data ?? []
}

export async function createPurchaseRequest(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }
  const { error } = await supabase.from('purchase_requests').insert({
    property_id: formData.get('property_id') as string,
    supply_id: (formData.get('supply_id') as string) || null,
    description: formData.get('description') as string,
    requested_by: user.id,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/')
  return { success: true }
}

export async function resolvePurchaseRequest(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('purchase_requests').update({
    status: 'purchased',
    resolved_by: user.id,
  }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/')
}
