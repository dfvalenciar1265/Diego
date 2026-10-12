/**
 * GET /logout
 * Ends the session and sends the person to /login (?inactive=1 if deactivated). Pages land here when
 * there is a session but no active team member (deactivated person) — redirecting
 * straight to /login would loop, since the proxy bounces signed-in users off /login.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Only say "desactivado" when that's the reason (no active team member row)
  let inactive = false
  if (user) {
    const { data: member } = await supabase
      .from('team_members').select('active').eq('id', user.id).maybeSingle()
    inactive = !member?.active
  }
  await supabase.auth.signOut({ scope: 'local' })
  const url = new URL('/login', req.url)
  if (inactive) url.searchParams.set('inactive', '1')
  return NextResponse.redirect(url)
}
