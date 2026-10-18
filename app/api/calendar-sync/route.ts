/**
 * /api/calendar-sync — descarga los ocho calendarios iCal de Airbnb y certifica la corrida
 * (lib/calendar-sync/sync.ts). Solo con Authorization: Bearer <CRON_SECRET>: lo llama el
 * programador de tareas cada pocos minutos. La respuesta trae conteos, nunca URL ni eventos.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkApiKey } from '@/lib/gpt-api/auth'
import { runCalendarSync } from '@/lib/calendar-sync/sync'

export const maxDuration = 30

async function handler(req: NextRequest) {
  const auth = checkApiKey(req.headers.get('authorization'), process.env.CRON_SECRET)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 503 ? 'not_configured' : 'unauthorized' }, { status: auth.status, headers: { 'Cache-Control': 'no-store' } })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ ok: false, error: 'faltan variables de Supabase' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const outcome = await runCalendarSync({ db, env: process.env, fetch, now: () => new Date() })
  if (!outcome.ok) console.warn('[calendar-sync]', outcome.error)
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } })
}

export const GET = handler    // programador de tareas (Vercel Cron / Supabase pg_cron)
export const POST = handler
