/** Solo servidor: importación compartida por cron y botón manual, sin llamadas a la URL de producción. */
import { createClient } from '@supabase/supabase-js'
import type { Db } from '@/lib/gpt-api/db'
import { fetchAirbnbEmailPage, getAccessToken, GmailCursorExpiredError } from '@/lib/gmail-sync'
import type { GmailEvent, GmailPage, GmailRun, SyncResult } from './types'
import { gmailNotice } from './presentation'

export function gmailSyncDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    global: { fetch: (input, init) => fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    }) },
  })
}
const MAX_PAGES = 3
const BUDGET_MS = 180_000
interface Dependencies {
  db: Db
  token?: typeof getAccessToken
  page?: (token: string, from: string, to: string, cursor: string | null) => Promise<GmailPage>
  now?: () => number
  id?: () => string
}
const publicResult = (run: GmailRun): SyncResult => {
  const result: SyncResult = {
  ok: run.status === 'complete', state: run.status === 'complete' ? 'complete' : run.status === 'partial' ? 'partial' : 'failed',
  run_id: run.id, new_count: run.stats.new_count ?? 0, updated_count: run.stats.updated_count ?? 0,
  cancelled_count: run.stats.cancelled_count ?? 0, pending_count: run.pending_count ?? 0,
  error_code: run.error_code, duplicate_task_groups: run.stats.duplicate_task_groups ?? 0,
  scan_complete: run.scan_complete, scope_from: run.scope_from, scope_to: run.scope_to,
  }
  if (!result.ok) result.error = gmailNotice(result).message
  return result
}

export async function runGmailSync(
  origin: { via: 'cron' | 'manual'; actorId?: string; days?: number }, deps: Dependencies,
): Promise<SyncResult> {
  const { db } = deps
  const now = deps.now ?? Date.now
  const start = now()
  const id = (deps.id ?? (() => crypto.randomUUID()))()
  let run: GmailRun
  try {
    const { data, error } = await db.rpc('gmail_sync_begin', {
      p_id: id, p_trigger: origin.via, p_days: origin.days ?? null, p_actor: origin.actorId ?? null,
    })
    if (error || !data?.run) return { ok: false, state: 'unavailable', error: 'Conciliación de Gmail no disponible. Revisa la migración y la configuración.' }
    if (data.busy) return { ok: false, state: 'busy', run_id: data.run.id, error: 'Ya hay una importación en curso. Consulta su estado antes de repetir.' }
    run = data.run as GmailRun
  } catch { return { ok: false, state: 'unavailable', error: 'No se pudo confirmar el inicio de la importación.' } }

  let stage: 'database_error' | 'gmail_unavailable' | 'not_connected' | 'deadline' = 'database_error'
  const rpc = async (name: string, args: Record<string, unknown>) => {
    stage = 'database_error'
    const result = await db.rpc(name, args)
    if (result.error) throw new Error('No se confirmó la operación de conciliación')
    return result.data
  }
  const apply = async (event: GmailEvent) => rpc('gmail_sync_apply', { p_run_id: id, p_event: event })
  try {
    const { data: settings, error } = await db.from('app_settings').select('value, updated_at').eq('key', 'gmail_refresh_token').maybeSingle()
    if (error) throw new Error('No se pudo consultar Gmail')
    if (!settings?.value) { stage = 'not_connected'; throw new Error('Gmail no conectado') }
    if (settings.updated_at !== run.connection_version && Date.parse(settings.updated_at) !== Date.parse(run.connection_version ?? '')) throw new Error('La conexión cambió')

    // Los errores persistidos se reintentan con datos normalizados; el recibo impide repetir efectos.
    const { data: retry, error: retryError } = await db.from('gmail_sync_events')
      .select('message_id, kind, source_at, payload').eq('connection_version', run.connection_version)
      .in('status', ['error', 'conflict']).order('last_attempt_at').limit(50)
    if (retryError) throw new Error('No se pudieron consultar los pendientes')
    for (const event of (retry ?? []) as GmailEvent[]) {
      if (now() - start >= BUDGET_MS) { stage = 'deadline'; throw new Error('Lectura aplazada') }
      await apply(event)
    }
    stage = 'gmail_unavailable'
    const token = await (deps.token ?? getAccessToken)(settings.value)
    const stats = { pages_fetched: 0, threads_fetched: 0, messages_seen: 0 }
    const seenCursors = new Set<string>()
    let cursor = run.next_page_cursor
    let cursorReset = false
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      if (now() - start >= BUDGET_MS) break
      stage = 'gmail_unavailable'
      let page: GmailPage
      try {
        page = await (deps.page ?? fetchAirbnbEmailPage)(token, run.scope_from, run.scope_to, cursor)
      } catch (error) {
        if (!(error instanceof GmailCursorExpiredError) || !cursor || cursorReset) throw error
        // Gmail puede invalidar un cursor. Releer el mismo alcance es seguro por los recibos.
        cursorReset = true
        cursor = null
        seenCursors.clear()
        await rpc('gmail_sync_checkpoint', { p_id: id, p_cursor: null, p_complete: false, p_stats: stats })
        continue
      }
      if (page.next_cursor && (seenCursors.has(page.next_cursor) || page.next_cursor === cursor)) throw new Error('Paginación de Gmail inválida')
      if (page.next_cursor) seenCursors.add(page.next_cursor)
      for (const event of page.events) {
        if (now() - start >= BUDGET_MS) { stage = 'deadline'; throw new Error('Lectura aplazada') }
        await apply(event)
      }
      stats.pages_fetched++
      stats.threads_fetched += page.threads_fetched
      stats.messages_seen += page.messages_seen
      cursor = page.next_cursor
      await rpc('gmail_sync_checkpoint', { p_id: id, p_cursor: cursor, p_complete: cursor === null, p_stats: stats })
      run.scan_complete = cursor === null
      if (run.scan_complete) break
    }
    if (run.scan_complete) {
      // Una aceptación puede venir en una página anterior a su solicitud: volver a conciliar al terminar.
      const { data: pending, error: pendingError } = await db.from('gmail_sync_events')
        .select('message_id, kind, source_at, payload').eq('connection_version', run.connection_version)
        .in('status', ['error', 'conflict']).order('source_at').limit(50)
      if (pendingError) throw new Error('No se pudieron consultar los pendientes')
      for (const event of (pending ?? []) as GmailEvent[]) {
        if (now() - start >= BUDGET_MS) break
        await apply(event)
      }
      if (now() - start < BUDGET_MS) await rpc('gmail_sync_maintenance', { p_id: id })
    }
    const overdue=now()-start>=BUDGET_MS
    const finished = await rpc('gmail_sync_finish', {
      p_id: id, p_status: run.scan_complete && !overdue ? 'complete' : 'partial', p_error: overdue ? 'deadline' : run.scan_complete ? null : 'source_incomplete',
    }) as GmailRun
    return publicResult(finished)
  } catch {
    // No serializar errores del proveedor: pueden contener datos privados o credenciales.
    try {
      const { data, error } = await db.rpc('gmail_sync_finish', { p_id: id, p_status: 'failed', p_error: stage })
      if (!error && data) return { ...publicResult(data as GmailRun), ...(stage === 'not_connected' ? { connected: false } : {}) }
    } catch {}
    return { ok: false, state: 'failed', run_id: id, error: 'El resultado es incierto. Consulta conciliación antes de reintentar.' }
  }
}
