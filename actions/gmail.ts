'use server'

import { revalidatePath } from 'next/cache'

export interface SyncResult {
  ok: boolean
  new_count?: number
  total_found?: number
  connected?: boolean
  error?: string
}

/**
 * Triggers Gmail sync from a server action (manual button press).
 * Calls the /api/gmail-sync route, which handles auth + parsing + DB writes.
 */
export async function syncGmail(): Promise<SyncResult> {
  if (!process.env.CRON_SECRET) {
    return { ok: false, error: 'CRON_SECRET no configurado en variables de entorno' }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4000'

  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/gmail-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `No se pudo conectar al servidor: ${msg}` }
  }

  let body: SyncResult
  try {
    body = await res.json() as SyncResult
  } catch {
    return { ok: false, error: `Respuesta inválida del servidor (HTTP ${res.status})` }
  }

  if (!res.ok || !body.ok) {
    return {
      ok: false,
      error: body.error ?? `Error del servidor (HTTP ${res.status})`,
    }
  }

  if ((body.new_count ?? 0) > 0) {
    revalidatePath('/calendar')
    revalidatePath('/')
  }

  return body
}

/**
 * Returns whether Gmail is connected (refresh token stored in settings).
 */
export async function getGmailStatus(): Promise<{
  connected: boolean
  lastSync?: string
  lastNewCount?: number
}> {
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: tokenRow }, { data: lastLog }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'gmail_refresh_token').single(),
    supabase
      .from('gmail_sync_log')
      .select('created_at, new_count')
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  return {
    connected:    !!tokenRow?.value,
    lastSync:     lastLog?.created_at,
    lastNewCount: lastLog?.new_count,
  }
}
