/**
 * GET /api/gmail-auth/callback
 * Handles Google OAuth redirect — exchanges code for tokens and stores refresh_token.
 *
 * Two checks before anything is stored (the stored token decides which inbox the
 * sync reads, i.e. where reservations come from):
 *   • `state` must match the one-time cookie set by /api/gmail-auth in this browser
 *   • the caller must be a signed-in, active admin
 * Without them, anyone holding a Google code for this app could swap in their own
 * Gmail and inject reservations, or trick Diego's browser into doing it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { GMAIL_STATE_COOKIE, stateMatches } from '@/lib/oauth-state'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/settings/gmail`
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${settingsUrl}?error=${encodeURIComponent(reason)}`)
    res.cookies.delete({ name: GMAIL_STATE_COOKIE, path: '/api/gmail-auth' })
    return res
  }

  if (!stateMatches(req.cookies.get(GMAIL_STATE_COOKIE)?.value, searchParams.get('state'))) {
    return fail('invalid_state')
  }
  if (error || !code) return fail(error ?? 'no_code')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail('not_signed_in')
  const { data: member } = await supabase
    .from('team_members').select('role, active').eq('id', user.id).single()
  if (member?.role !== 'admin' || !member.active) return fail('forbidden')

  // Exchange code for tokens
  const params = new URLSearchParams({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail-auth/callback`,
    grant_type:    'authorization_code',
  })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!tokenRes.ok) return fail('token_exchange_failed')

  const { refresh_token } = await tokenRes.json() as { refresh_token?: string }
  if (!refresh_token) return fail('no_refresh_token')

  // Store in Supabase using service role (bypasses RLS for server-side storage)
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error: saveError } = await db.from('app_settings').upsert(
    { key: 'gmail_refresh_token', value: refresh_token, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )
  if (saveError) return fail('save_failed')

  const res = NextResponse.redirect(`${settingsUrl}?connected=true`)
  res.cookies.delete({ name: GMAIL_STATE_COOKIE, path: '/api/gmail-auth' })
  return res
}
