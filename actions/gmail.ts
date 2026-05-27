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
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4000'

  const res = await fetch(`${baseUrl}/api/gmail-sync`, {
    method: 'POST',
    // No cron secret header → route validates admin session via cookies
    // The server action runs server-side so cookies are forwarded automatically
    headers: { 'Content-Type': 'application/json' },
  })

  const body = await res.json() as SyncResult

  if (body.ok && (body.new_count ?? 0) > 0) {
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
