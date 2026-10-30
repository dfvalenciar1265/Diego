'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { writeReservationTime, type TimeWrite } from '@/lib/reservation-time-writes'

export async function saveReservationTime(input: TimeWrite) {
  const member = await getCurrentMember()
  if (!member || member.role !== 'admin') return { success: false, error: 'Solo un administrador activo puede registrar horarios.' }
  const result = await writeReservationTime(await createClient(), input, { id: member.id, via: 'app' })
  if (!result.ok) return { success: false, error: result.error }
  for (const path of ['/', '/cleaning', '/tasks']) revalidatePath(path)
  return { success: true }
}
