'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { recordHistoricalBuildingNoticeTool, listBuildingNoticesTool, writeBuildingNoticeTool } from '@/lib/gpt-api/service'

export async function getBuildingNotices(reservationId: string) {
  const member = await getCurrentMember()
  return listBuildingNoticesTool(await createClient(), { reservation_id: reservationId },
    member ? { id: member.id, via: 'app' } : null)
}
export async function manageBuildingNotice(operation: 'verify_recipient' | 'prepare' | 'record', input: unknown) {
  const member = await getCurrentMember()
  const result = await writeBuildingNoticeTool(await createClient(), operation, input,
    member ? { id: member.id, via: 'app' } : null)
  if (result.ok) revalidatePath('/')
  return result
}

export async function recordHistoricalBuildingNotice(input: unknown) {
  const member = await getCurrentMember()
  const result = await recordHistoricalBuildingNoticeTool(await createClient(), input,
    member ? { id: member.id, via: 'app' } : null)
  if (result.ok) revalidatePath('/')
  return result
}
