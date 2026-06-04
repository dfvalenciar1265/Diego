import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { TeamMember } from '@/lib/types'

/**
 * Per-request memoized auth helpers.
 *
 * React's `cache()` dedupes calls within a single server render pass. The
 * (app) layout AND the page both need the current user + their team_member
 * record, but without caching that would mean 2× `auth.getUser()` (each a
 * network round-trip to Supabase Auth) plus 2× `team_members` queries on
 * every navigation. Wrapping them in `cache()` collapses that to one each.
 */

export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/** Returns the full team_members row for the signed-in user, or null. */
export const getCurrentMember = cache(async (): Promise<TeamMember | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('team_members')
    .select('*')
    .eq('id', user.id)
    .single()
  return data
})
