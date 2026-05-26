'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PropertySupply, Supply } from '@/lib/types'

export async function getPropertySupplies(propertyId: string): Promise<PropertySupply[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('property_supplies')
    .select('*, supply:supplies(*)')
    .eq('property_id', propertyId)
    .order('supply(name)')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getLowStockAlerts(): Promise<PropertySupply[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('property_supplies')
    .select('*, supply:supplies(*), property:properties(name)')
  if (error) throw new Error(error.message)
  return (data ?? []).filter(r => r.current_qty <= r.min_qty)
}

export async function updateStock(
  id: string,
  delta: number
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: current } = await supabase
    .from('property_supplies').select('current_qty').eq('id', id).single()
  if (!current) return

  const newQty = Math.max(0, current.current_qty + delta)
  const { error } = await supabase.from('property_supplies').update({
    current_qty: newQty,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/properties')
  revalidatePath('/')
}

export async function addSupplyToProperty(
  propertyId: string,
  supplyId: string,
  minQty: number
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('property_supplies').upsert({
    property_id: propertyId,
    supply_id: supplyId,
    current_qty: 0,
    min_qty: minQty,
  }, { onConflict: 'property_id,supply_id' })
  if (error) throw new Error(error.message)
  revalidatePath(`/properties/${propertyId}`)
}

export async function getAllSupplies(): Promise<Supply[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('supplies').select('*').order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createSupply(name: string, unit: string): Promise<Supply> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supplies').insert({ name, unit }).select().single()
  if (error) throw new Error(error.message)
  return data
}
