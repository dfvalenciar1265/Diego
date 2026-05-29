'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Expense, ExpenseStatus } from '@/lib/types'

export async function getExpenses(filters?: {
  propertyId?: string
  year?: number
  month?: number
}): Promise<Expense[]> {
  const supabase = await createClient()
  let query = supabase
    .from('expenses')
    .select('*, property:properties(name)')
    .order('date', { ascending: false })

  if (filters?.propertyId) query = query.eq('property_id', filters.propertyId)
  if (filters?.year && filters?.month) {
    const y = filters.year
    const m = String(filters.month).padStart(2, '0')
    const nextY = filters.month === 12 ? y + 1 : y
    const nextM = String(filters.month === 12 ? 1 : filters.month + 1).padStart(2, '0')
    query = query.gte('date', `${y}-${m}-01`).lt('date', `${nextY}-${nextM}-01`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createExpense(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autorizado' }

  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  if (member?.role !== 'admin') return { success: false, error: 'Solo administradores' }

  const amountRaw = formData.get('amount') as string
  const amount = parseFloat(amountRaw.replace(/\./g, '').replace(',', '.'))
  if (!amount || amount <= 0) return { success: false, error: 'Monto inválido' }

  const { error } = await supabase.from('expenses').insert({
    property_id: formData.get('property_id') as string,
    provider:    (formData.get('provider') as string).trim(),
    date:        formData.get('date') as string,
    amount,
    status:      (formData.get('status') as ExpenseStatus) ?? 'pending',
    notes:       (formData.get('notes') as string) || null,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/reports')
  return { success: true }
}

export async function toggleExpenseStatus(
  id: string,
  current: ExpenseStatus
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const newStatus: ExpenseStatus = current === 'pending' ? 'paid' : 'pending'
  const { error } = await supabase
    .from('expenses').update({ status: newStatus }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/reports')
  return { success: true }
}

export async function deleteExpense(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/reports')
  return { success: true }
}
