import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { TeamMember } from '@/lib/types'

/**
 * Per-request memoized auth helpers.
 *
 * React's `cache()` dedupes calls within a single server render pass. The
 * (app) layout AND the page both need the current user + their team_member
 * record; wrapping them in `cache()` collapses that to one lookup each.
 */

export const getCurrentUser = cache(async (): Promise<{ id: string; email?: string } | null> => {
  const supabase = await createClient()
  // Verified locally against the cached signing key (no Auth round-trip);
  // the proxy has already refreshed the session cookie on this request.
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) return null
  return { id: data.claims.sub, email: data.claims.email }
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
