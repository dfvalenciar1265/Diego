'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { advanceCheckoutCleaning } from '@/lib/gpt-api/checkout-cleaning'
import { canOperateCheckoutCleaning, type CheckoutCleaningInput } from '@/lib/checkout-cleaning'

export async function saveCheckoutCleaning(input: CheckoutCleaningInput) {
  const member = await getCurrentMember()
  if (!member || !canOperateCheckoutCleaning(member.role)) return { success: false, error: 'Tu sesión no tiene permiso para esta limpieza.' }
  const result = await advanceCheckoutCleaning(await createClient(), input, member)
  if (result.success) {
    revalidatePath('/')
    revalidatePath('/cleaning')
    revalidatePath('/tasks')
  }
  return result
}
