/**
 * GET /api/gmail-auth/callback
 * Handles Google OAuth redirect — exchanges code for tokens and stores refresh_token.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/settings/gmail`

  if (error || !code) {
    return NextResponse.redirect(`${settingsUrl}?error=${error ?? 'no_code'}`)
  }

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

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${settingsUrl}?error=token_exchange_failed`)
  }

  const { refresh_token } = await tokenRes.json() as { refresh_token?: string }
  if (!refresh_token) {
    return NextResponse.redirect(`${settingsUrl}?error=no_refresh_token`)
  }

  // Store in Supabase using service role (bypasses RLS for server-side storage)
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  await supabase.from('app_settings').upsert(
    { key: 'gmail_refresh_token', value: refresh_token, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )

  return NextResponse.redirect(`${settingsUrl}?connected=true`)
}
