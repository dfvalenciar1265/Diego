export type GmailEventKind = 'confirmation' | 'update' | 'cancellation' | 'change_request' | 'unparsed'
export interface GmailEvent {
  message_id: string
  kind: GmailEventKind
  source_at: string | null
  payload: Record<string, unknown>
}
export interface GmailPage {
  events: GmailEvent[]
  next_cursor: string | null
  threads_fetched: number
  messages_seen: number
}
export interface GmailRun {
  id: string
  root_id: string
  parent_id: string | null
  status: 'running' | 'complete' | 'partial' | 'failed' | 'interrupted'
  connection_version: string | null
  started_at: string
  finished_at: string | null
  lease_until: string
  scope_from: string
  scope_to: string
  next_page_cursor: string | null
  scan_complete: boolean
  stats: Record<string, number>
  error_code: string | null
  pending_count?: number
}
export interface SyncResult {
  ok: boolean
  state: 'complete' | 'partial' | 'failed' | 'busy' | 'unavailable'
  run_id?: string
  new_count?: number
  updated_count?: number
  cancelled_count?: number
  pending_count?: number
  scan_complete?: boolean
  scope_from?: string
  scope_to?: string
  connected?: boolean
  error?: string
}
export interface GmailIssue {
  id: string
  kind: GmailEventKind
  code: string | null
  reservation_id: string | null
  source_at: string | null
  status: 'conflict' | 'error'
  reason: string
  version: number
}
