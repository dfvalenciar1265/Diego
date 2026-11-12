'use server'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { listDirectMessagePlans, saveDirectMessageDraft } from '@/lib/gpt-api/direct-messages'
import { revalidatePath } from 'next/cache'
export async function getDirectMessagePlans() {
 const member = await getCurrentMember()
 return listDirectMessagePlans(await createClient(), member ? { id: member.id, via: 'app' } : null)
}
export async function saveDirectDraft(input: unknown) {
 const member = await getCurrentMember()
 const result = await saveDirectMessageDraft(await createClient(), member ? { id: member.id, via: 'app' } : null, input)
 if (result.ok) revalidatePath('/direct-messages')
 return result
}
