/**
 * GET /api/gmail-auth
 * Initiates the Google OAuth consent flow.
 * Only admins can trigger this (middleware + server check).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GMAIL_STATE_COOKIE, newOAuthState } from '@/lib/oauth-state'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

export async function GET(req: NextRequest) {
  // Verify admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const { data: member } = await supabase
    .from('team_members').select('role, active').eq('id', user.id).single()
  if (member?.role !== 'admin' || !member.active) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const state = newOAuthState()
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail-auth/callback`,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // get refresh_token
    prompt:        'consent',   // force consent to always get refresh_token
    state,                      // checked by the callback (CSRF / foreign-code protection)
  })

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  )
  res.cookies.set(GMAIL_STATE_COOKIE, state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',              // sent on Google's top-level redirect back to us
    path:     '/api/gmail-auth',
    maxAge:   600,
  })
  return res
}
