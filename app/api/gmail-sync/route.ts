/**
 * POST /api/gmail-sync
 *
 * Triggered by:
 *  - Vercel cron (hourly, via vercel.json)
 *  - Manual button in the calendar page (server action calls this)
 *
 * Security: requires either:
 *  - CRON_SECRET header (for Vercel cron)
 *  - Authenticated admin session (for manual trigger)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccessToken, fetchAirbnbReservations } from '@/lib/gmail-sync'

// One day before check-in, formatted as YYYY-MM-DD
function dayBefore(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Shared handler for both GET (Vercel cron) and POST (manual trigger)
async function syncHandler(req: NextRequest, isCronRequest: boolean) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  // Vercel cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get('authorization')
  const isCron = isCronRequest &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    // Manual trigger: verify admin session
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: member } = await supabase
      .from('team_members')
      .select('role')
      .eq('id', user.id)
      .single()
    if (member?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const triggeredBy = isCron ? 'cron' : 'manual'

  // ── Get stored refresh token ────────────────────────────────────────────────
  // Use service role client since app_settings RLS requires admin role
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tokenRow } = await serviceClient
    .from('app_settings')
    .select('value')
    .eq('key', 'gmail_refresh_token')
    .single()

  if (!tokenRow?.value) {
    await serviceClient.from('gmail_sync_log').insert({
      triggered_by: triggeredBy,
      new_count: 0,
      error: 'Gmail no conectado — configura el refresh token en /settings/gmail',
    })
    return NextResponse.json(
      { error: 'Gmail not connected', connected: false },
      { status: 422 }
    )
  }

  // ── Fetch and parse emails ──────────────────────────────────────────────────
  let accessToken: string
  try {
    accessToken = await getAccessToken(tokenRow.value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await serviceClient.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: 0, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  let reservations
  try {
    reservations = await fetchAirbnbReservations(accessToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await serviceClient.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: 0, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── Upsert reservations (skip duplicates by airbnb_code) ───────────────────
  let newCount = 0

  for (const r of reservations) {
    // Check if this airbnb_code already exists
    const { data: existing } = await serviceClient
      .from('reservations')
      .select('id')
      .eq('airbnb_code', r.airbnb_code)
      .single()

    if (existing) continue  // already imported

    const { data: inserted, error: insertErr } = await serviceClient
      .from('reservations')
      .insert(r)
      .select('id')
      .single()

    if (insertErr || !inserted) continue
    newCount++

    // ── Auto-create tasks ───────────────────────────────────────────────────
    // 1. Cleaning task: on check-out day
    // 2. Preparation task: day before check-in (or check-in day if same day)
    const prepDate = dayBefore(r.check_in) >= r.check_out
      ? r.check_in   // avoid scheduling prep before cleaning if back-to-back
      : dayBefore(r.check_in)

    await serviceClient.from('tasks').insert([
      {
        property_id:    r.property_id,
        reservation_id: inserted.id,
        type:           'cleaning',
        scheduled_for:  r.check_out,
        status:         'pending',
        notes:          `Limpieza post-estadía — ${r.guest_name}`,
      },
      {
        property_id:    r.property_id,
        reservation_id: inserted.id,
        type:           'preparation',
        scheduled_for:  prepDate,
        status:         'pending',
        notes:          `Preparación para ${r.guest_name} (check-in ${r.check_in})`,
      },
    ])
  }

  // ── Log the sync ────────────────────────────────────────────────────────────
  await serviceClient.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: newCount })

  return NextResponse.json({
    ok: true,
    new_count: newCount,
    total_found: reservations.length,
    triggered_by: triggeredBy,
  })
}

// Vercel cron uses GET
export async function GET(req: NextRequest) {
  return syncHandler(req, true)
}

// Manual trigger from UI uses POST
export async function POST(req: NextRequest) {
  return syncHandler(req, false)
}
