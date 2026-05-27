/**
 * GET /api/gmail-auth
 * Initiates the Google OAuth consent flow.
 * Only admins can trigger this (middleware + server check).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

export async function GET(req: NextRequest) {
  // Verify admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  if (member?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail-auth/callback`,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // get refresh_token
    prompt:        'consent',   // force consent to always get refresh_token
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  )
}
