/**
 * /api/gmail-sync
 *
 * Handles both:
 *  - GET  → Vercel cron (hourly), authenticated via Authorization: Bearer <CRON_SECRET>
 *  - POST → Manual trigger from admin UI, authenticated via session cookie
 *
 * For each sync run:
 *   1. Imports new "Reservación confirmada" emails → insert reservations + auto-create tasks
 *   2. Processes "quiere hacer un cambio" emails → notes change request on reservation
 *   3. Processes "Reservación actualizada" emails → marks the request accepted, flags the
 *      reservation, or imports it if missing (after 2, so a request and its acceptance
 *      arriving in the same run pair up)
 *   4. Repairs active reservations left without their cleaning/preparation tasks
 *   5. Auto-completes tasks whose scheduled date is in the past
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  getAccessToken,
  fetchAirbnbEmails,
  fetchConfirmationByCode,
  resolvePropertyId,
  guestNameMatches,
  type ParsedReservation,
  type ChangeRequestFlag,
} from '@/lib/gmail-sync'
import { completeOverdueTasks } from '@/actions/tasks'
import { cleaningTaskFor, preparationTaskFor, missingTurnoverTasks } from '@/lib/turnover-tasks'

// Use a loose type for the service client to avoid complex generic mismatches
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceDb = any

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

  // Fetch all Airbnb emails (confirmadas + actualizadas + cambios)
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
  let changeRequestCount = 0
  let cancelledCount = 0

  // ── 1. Import new "Reservación confirmada" emails ────────────────────────
  for (const r of emailResult.confirmed) {
    const inserted = await insertReservationIfNew(db, r)
    if (inserted) newCount++
  }

  // ── 1b. Process "Reservación cancelada" emails ───────────────────────────
  for (const code of emailResult.cancelled) {
    const { data: existing } = await db
      .from('reservations').select('id, status').eq('airbnb_code', code).single()
    if (existing && existing.status !== 'cancelled') {
      await db.from('reservations').update({ status: 'cancelled' }).eq('id', existing.id)
      // Delete ALL tasks for this reservation (any status)
      await db.from('tasks').delete().eq('reservation_id', existing.id)
      cancelledCount++
    }
  }

  // ── 2. Process "[Guest] quiere hacer un cambio" emails ──────────────────
  // Before the updates: when the request and its acceptance arrive in the same
  // run, the acceptance must find the request already recorded.
  // Reservations whose request is already reflected — their "actualizada" email
  // below is that same change, not something new to verify.
  const alreadyApplied = new Set<string>()
  for (const req of emailResult.change_requests) {
    changeRequestCount += await handleChangeRequest(db, req, alreadyApplied)
  }

  // ── 3. Process "Reservación actualizada" emails ──────────────────────────
  for (const flag of emailResult.updated) {
    // Check if reservation already in DB
    let existing: { id: string; notes: string | null; pending_change: unknown } | null = null

    if (flag.airbnb_code) {
      const { data } = await db
        .from('reservations').select('id, notes, pending_change')
        .eq('airbnb_code', flag.airbnb_code).maybeSingle()
      existing = data
    }

    // Fallback when the email carried no confirmation code: match by guest name,
    // but ONLY among reservations that already have a change request waiting to
    // be accepted — and only if exactly one matches.
    if (!existing && flag.guest_name && flag.guest_name !== 'Desconocido') {
      // Name compared in JS (accent-insensitive); the rows with a pending change are few.
      const { data: cands } = await db
        .from('reservations').select('id, guest_name, notes, pending_change')
        .eq('status', 'confirmed')
        .not('pending_change', 'is', null)
      const waiting = (cands ?? []).filter(
        c => guestNameMatches(c.guest_name, flag.guest_name) &&
             !(c.pending_change as { accepted_at?: string | null } | null)?.accepted_at
      )
      if (waiting.length === 1) existing = waiting[0]
    }

    if (existing) {
      const pending = existing.pending_change as { accepted_at?: string | null; requested_at?: string } | null
      if (pending && !pending.accepted_at) {
        // An update sent before the request was made belongs to an earlier change.
        if (pending.requested_at && flag.email_date < pending.requested_at) continue
        // The guest's request was accepted — stamp it so the app can offer
        // "Aplicar" with the exact change (guests/dates) already parsed.
        await db.from('reservations')
          .update({ pending_change: { ...pending, accepted_at: flag.email_date } })
          .eq('id', existing.id)
        updatedCount++
      } else if (!pending) {
        if (alreadyApplied.has(existing.id)) continue
        // Long manual resyncs re-read old updates whose change was applied long
        // ago; only recent ones (the cron's 7-day window) can still need a check.
        if (Date.now() - new Date(flag.email_date).getTime() > 7 * 86400000) continue
        // No request on file (e.g. changed directly in Airbnb) — we can't know what
        // changed, so fall back to flagging it for a manual check.
        const alreadyFlagged = existing.notes?.includes('⚠️ Fechas actualizadas')
        if (!alreadyFlagged) {
          const newNotes = (existing.notes ?? '') + ' | ⚠️ Fechas actualizadas — verificar en Airbnb'
          await db.from('reservations').update({ notes: newNotes }).eq('id', existing.id)
          updatedCount++
        }
      }
    } else if (flag.airbnb_code) {
      // Not in DB yet — search Gmail for the original confirmation and import it
      const confirmation = await fetchConfirmationByCode(accessToken, flag.airbnb_code)
      if (confirmation) {
        const inserted = await insertReservationIfNew(db, confirmation)
        if (inserted) newCount++
      }
    }
  }

  // ── 4. Repair reservations without turnover tasks ───────────────────────
  // The task insert right after a reservation insert can fail on its own (that's
  // how the 27-sep check-in at Tocahagua 1208 ended up with no prep and no cleaning:
  // counted as a check-in on the home but missing from "Preparación hoy").
  const repairedTasks = await repairMissingTurnoverTasks(db)

  // ── 5. Auto-complete past tasks ──────────────────────────────────────────
  // Any cleaning/preparation task whose date has already passed gets marked done
  // automatically so the task list stays clean.
  const completedTasks = await completeOverdueTasks()

  await db.from('gmail_sync_log').insert({ triggered_by: triggeredBy, new_count: newCount })

  return NextResponse.json({
    ok: true,
    new_count: newCount,
    updated_count: updatedCount,
    cancelled_count: cancelledCount,
    change_requests: changeRequestCount,
    repaired_tasks: repairedTasks,
    completed_tasks: completedTasks,
    emails_parsed: emailResult.confirmed.length + emailResult.updated.length + emailResult.cancelled.length + emailResult.change_requests.length,
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

// ─── Helper: note a change request on the matching reservation ───────────────

/**
 * Records a guest's change request on the matching reservation as `pending_change`.
 * These emails carry no confirmation code, so we match on guest first name AND the
 * apartment named in the email AND an active/future stay — and only when exactly
 * ONE reservation matches. Anything ambiguous is skipped rather than risking the
 * wrong booking. The change is only offered for applying once the
 * "Se actualizó la reservación" email stamps accepted_at.
 */
async function handleChangeRequest(
  db: ServiceDb,
  req: ChangeRequestFlag,
  alreadyApplied: Set<string>,
): Promise<number> {
  if (!req.guest_name.trim()) return 0

  // Resolve the apartment from the email's property line ("Marina rey 1104 · Apartamento…")
  const { data: properties } = await db.from('properties').select('id, name')
  const propHaystack = req.property_name.toLowerCase()
  const propList = (properties ?? []) as { id: string; name: string }[]
  let property = propList.find(p => propHaystack.includes(p.name.toLowerCase()))
  // Fallback for listings whose email name differs from the app name (e.g. the
  // "Loft Moderno … Ángel del Mar" listing = Cartagena Beach Crespo 1214).
  if (!property) {
    const aliasId = resolvePropertyId(req.property_name)
    if (aliasId) property = propList.find(p => p.id === aliasId)
  }

  const today = new Date().toISOString().slice(0, 10)
  let query = db
    .from('reservations')
    .select('id, guest_name, check_in, check_out, guests, pending_change')
    .eq('status', 'confirmed')
    .gte('check_out', today)          // only active/future stays can still change
  if (property) query = query.eq('property_id', property.id)

  const { data: rows } = await query
  type Candidate = { id: string; guest_name: string; check_in: string; check_out: string; guests: number | null; pending_change: unknown }
  let candidates = ((rows ?? []) as Candidate[]).filter(c => guestNameMatches(c.guest_name, req.guest_name))

  // A request already reflected in one of them was handled (by the one-tap apply
  // or by hand). Checked before narrowing: once applied, the booking no longer
  // looks like the "from" side, and a namesake still would (two Julieths, 1303).
  const asksSomething = req.guests_to != null || req.check_in_to != null || req.check_out_to != null
  const reflects = (c: Candidate) => asksSomething &&
    (req.guests_to == null || req.guests_to === c.guests) &&
    (req.check_in_to == null || req.check_in_to === c.check_in) &&
    (req.check_out_to == null || req.check_out_to === c.check_out)
  const applied = candidates.filter(reflects)
  if (applied.length > 0) {
    for (const c of applied) alreadyApplied.add(c.id)
    return 0
  }

  // Two guests with the same first name: keep the one whose CURRENT booking is
  // what the request says it changes from.
  if (candidates.length > 1) {
    candidates = candidates.filter(c =>
      (req.guests_from == null || c.guests === req.guests_from) &&
      (req.check_in_from == null || c.check_in === req.check_in_from) &&
      (req.check_out_from == null || c.check_out === req.check_out_from))
  }
  if (candidates.length !== 1) return 0   // 0 or still ambiguous → skip

  const target = candidates[0]
  const existing = target.pending_change as { description?: string; requested_at?: string } | null
  // Don't clobber a change that's already recorded and still waiting
  if (existing && existing.description === req.change_description) return 0
  // Don't let an older request (re-read by a long resync) replace a newer one
  if (existing?.requested_at && existing.requested_at > req.email_date) return 0

  const pending = {
    guests_from:    req.guests_from,
    guests_to:      req.guests_to,
    check_in_from:  req.check_in_from,
    check_in_to:    req.check_in_to,
    check_out_from: req.check_out_from,
    check_out_to:   req.check_out_to,
    description:    req.change_description,
    alteration_url: req.alteration_url,
    requested_at:   req.email_date,
    accepted_at:    null,
  }

  await db.from('reservations').update({ pending_change: pending }).eq('id', target.id)
  return 1
}

// ─── Helper: insert a reservation if not already present ─────────────────────

async function insertReservationIfNew(
  db: ServiceDb,
  r: ParsedReservation
): Promise<boolean> {
  const { data: existing } = await db
    .from('reservations').select('id, amount, guests').eq('airbnb_code', r.airbnb_code).single()

  if (existing) {
    const updates: Record<string, unknown> = {}
    // Fix previously mis-parsed amounts
    if (existing.amount < 5000 && r.amount >= 1000) updates.amount = r.amount
    // Backfill guest count if not yet stored
    if (existing.guests == null && r.guests != null) updates.guests = r.guests
    if (Object.keys(updates).length > 0) {
      await db.from('reservations').update(updates).eq('id', existing.id)
    }
    return false
  }

  const { data: inserted, error } = await db
    .from('reservations').insert(r).select('id').single()
  if (error || !inserted) return false

  // Auto-create cleaning + preparation tasks (a failure here is repaired by step 4).
  // A stay that already ended (old email caught by a long resync) needs none —
  // they'd only pile up as stale pending preparations.
  const today = new Date().toISOString().slice(0, 10)
  if (r.check_out < today) return true
  const reservation = { ...r, id: inserted.id }
  const { error: taskError } = await db.from('tasks')
    .insert([cleaningTaskFor(reservation), preparationTaskFor(reservation)])
  if (taskError) console.error('[gmail-sync] task insert failed for', r.airbnb_code, taskError.message)

  return true
}

// ─── Helper: give active reservations their missing turnover tasks ───────────

async function repairMissingTurnoverTasks(db: ServiceDb): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db
    .from('reservations')
    .select('id, property_id, guest_name, check_in, check_out, tasks(type)')
    .eq('status', 'confirmed')
    .gte('check_out', today)
  if (error) {
    console.error('[gmail-sync] repair query failed', error.message)
    return 0
  }

  const rows = missingTurnoverTasks(data ?? [], today)
  if (rows.length === 0) return 0

  const { error: insertError } = await db.from('tasks').insert(rows)
  if (insertError) {
    console.error('[gmail-sync] repair insert failed', insertError.message)
    return 0
  }
  return rows.length
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  return syncHandler(req, true)   // Vercel cron
}

export async function POST(req: NextRequest) {
  return syncHandler(req, false)  // Manual trigger
}
