'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { canConfirmPreparation, writePreparation, type PreparationWrite } from '@/lib/gpt-api/preparation'

export async function saveArrivalPreparation(input: PreparationWrite) {
  const member = await getCurrentMember()
  if (!member || !canConfirmPreparation(member.role, input?.step)) return { success: false, error: 'No tienes permiso para confirmar esta etapa.' }
  const result = await writePreparation(await createClient(), input, { id: member.id, via: 'app' })
  if (!result.ok) return { success: false, error: result.error, conflict: result.status === 409, current: 'current' in result ? result.current : null }
  revalidatePath('/')
  return { success: true, data: result.data }
}
