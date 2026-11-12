'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { listPreventiveReviews, savePreventiveReview } from '@/lib/gpt-api/preventive-review'
export async function getPreventiveReviews() {
 const member = await getCurrentMember()
 return listPreventiveReviews(await createClient(), member ? {id:member.id,via:'app'} : null)
}
export async function recordPreventiveReview(input: unknown) {
 const member = await getCurrentMember()
 const result = await savePreventiveReview(await createClient(), member ? {id:member.id,via:'app'} : null,input)
 if(result.ok){revalidatePath('/maintenance/review');revalidatePath('/maintenance');revalidatePath('/')}
 return result
}
