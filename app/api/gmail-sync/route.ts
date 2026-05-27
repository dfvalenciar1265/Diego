/**
 * /api/gmail-sync
 *
 * Handles both:
 *  - GET  → Vercel cron (hourly), authenticated via Authorization: Bearer <CRON_SECRET>
 *  - POST → Manual trigger from admin UI, authenticated via session cookie
 *
 * For each sync run:
 *   1. Imports new "Reservación confirmada" emails → insert reservations + auto-create tasks
 *   2. Processes "Reservación actualizada" emails → flag existing reservations OR import if missing
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  getAccessToken,
  fetchAirbnbEmails,
  fetchConfirmationByCode,
  type ParsedReservation,
} from '@/lib/gmail-sync'

// Use a loose type for the service client to avoid complex generic mismatches
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceDb = any

// Day before a date (YYYY-MM-DD)
function dayBefore(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ─── Shared sync handler ──────────────────────────────────────────────────────

async function syncHandler(req: NextRequest, fromCron: boolean) {
  // Auth check
  // A valid CRON_SECRET header is trusted on any method:
  //   • GET  → Vercel cron scheduler
  //   • POST → internal server action (syncGmail) — no cookie jar in Node.js fetch
  const hasValidSecret =
    req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`

  if (!hasValidSecret) {
    // Fallback: accept a logged-in admin session (browser-originated POST)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members').select('role').eq('id', user.id).single()
    if (member?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const triggeredBy = (fromCron && hasValidSecret) ? 'cron' : 'manual'

  // Service client for DB writes (bypasses RLS)
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get stored refresh token
  const { data: tokenRow } = await db
    .from('app_settings').select('value').eq('key', 'gmail_refresh_token').single()

  if (!tokenRow?.value) {
    await db.from('gmail_sync_log').insert({
      triggered_by: triggeredBy, new_count: 0,
      error: 'Gmail no conectado — ir a /settings/gmail',
    })
    return NextResponse.json({ error: 'Gmail not connected', connected: false }, { status: 422 })
  }

  // Exchange refresh token for access token
  let accessToken: string
  try {
    accessToken = await getAccessToken(tokenRow.value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: 0, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Determine lookback window:
  //   • Cron runs    → 7 days  (only needs recent bookings)
  //   • Manual/POST  → ?days param, default 365 (catch old confirmed emails)
  const isFromCron = fromCron && hasValidSecret
  const defaultDays = isFromCron ? 7 : 365
  const daysParam = req.nextUrl?.searchParams.get('days')
  const lookbackDays = daysParam ? Math.max(1, Math.min(1825, parseInt(daysParam, 10))) : defaultDays
  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  // Fetch all Airbnb emails (confirmadas + actualizadas)
  let emailResult
  try {
    emailResult = await fetchAirbnbEmails(accessToken, sinceDate)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: 0, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  let newCount = 0
  let updatedCount = 0

  // ── 1. Import new "Reservación confirmada" emails ────────────────────────
  for (const r of emailResult.confirmed) {
    const inserted = await insertReservationIfNew(db, r)
    if (inserted) newCount++
  }

  // ── 2. Process "Reservación actualizada" emails ──────────────────────────
  for (const flag of emailResult.updated) {
    // Check if reservation already in DB
    const { data: existing } = await db
      .from('reservations').select('id, notes')
      .eq('airbnb_code', flag.airbnb_code).single()

    if (existing) {
      // Flag it as updated so the user knows to check Airbnb for new dates
      const alreadyFlagged = existing.notes?.includes('⚠️ Fechas actualizadas')
      if (!alreadyFlagged) {
        const newNotes = (existing.notes ?? '') + ' | ⚠️ Fechas actualizadas — verificar en Airbnb'
        await db.from('reservations').update({ notes: newNotes }).eq('id', existing.id)
        updatedCount++
      }
    } else {
      // Not in DB yet — search Gmail for the original confirmation and import it
      const confirmation = await fetchConfirmationByCode(accessToken, flag.airbnb_code)
      if (confirmation) {
        const inserted = await insertReservationIfNew(db, confirmation)
        if (inserted) newCount++
      }
    }
  }

  await db.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: newCount })

  return NextResponse.json({
    ok: true,
    new_count: newCount,
    updated_count: updatedCount,
    emails_parsed: emailResult.confirmed.length + emailResult.updated.length,
    threads_fetched: emailResult.threads_fetched,
    skipped_no_room: emailResult.skipped_no_room,
    d_empty_text: emailResult.d_empty_text,
    d_not_airbnb: emailResult.d_not_airbnb,
    d_parse_fail: emailResult.d_parse_fail,
    d_fail_code: emailResult.d_fail_code,
    d_fail_guest: emailResult.d_fail_guest,
    d_fail_dates: emailResult.d_fail_dates,
    triggered_by: triggeredBy,
    lookback_days: lookbackDays,
    since_date: sinceDate.toISOString().slice(0, 10),
  })
}

// ─── Helper: insert a reservation if not already present ─────────────────────

async function insertReservationIfNew(
  db: ServiceDb,
  r: ParsedReservation
): Promise<boolean> {
  const { data: existing } = await db
    .from('reservations').select('id').eq('airbnb_code', r.airbnb_code).single()
  if (existing) return false

  const { data: inserted, error } = await db
    .from('reservations').insert(r).select('id').single()
  if (error || !inserted) return false

  // Auto-create cleaning + preparation tasks
  const prepDate =
    dayBefore(r.check_in) >= r.check_out
      ? r.check_in        // back-to-back: prep same day as check-in
      : dayBefore(r.check_in)

  await db.from('tasks').insert([
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

  return true
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  return syncHandler(req, true)   // Vercel cron
}

export async function POST(req: NextRequest) {
  return syncHandler(req, false)  // Manual trigger
}
