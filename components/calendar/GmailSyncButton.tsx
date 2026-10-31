'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { syncGmail } from '@/actions/gmail'
import { useUserRole } from '@/lib/user-context'
import { gmailNotice } from '@/lib/gmail-reconciliation/presentation'
import type { SyncResult } from '@/lib/gmail-reconciliation/types'
import { toast } from '@/components/ui/feedback'

export function GmailSyncButton() {
  const role = useUserRole()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SyncResult | null>(null)
  const notice = result ? gmailNotice(result) : null
  function handleSync() {
    setResult(null)
    startTransition(async () => {
      let value: SyncResult
      try { value = await syncGmail() }
      catch { value = { ok: false, state: 'failed', error: 'Resultado incierto. Revisa conciliación antes de repetir.' } }
      setResult(value)
      const message = gmailNotice(value)
      if (message.tone === 'success') toast.success(message.message)
      else if (message.tone === 'warning') toast.warning(message.message)
      else toast.error(`No se pudo sincronizar Gmail: ${message.message}`)
    })
  }
  if (role !== 'admin') return null
  const complete = result?.state === 'complete'
  const fresh = result?.new_count ?? 0
  return <div className="flex shrink-0 items-center gap-2">
    <button onClick={handleSync} disabled={isPending} title="Sincronizar Gmail"
      className="relative flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-semibold text-white disabled:opacity-60"
      style={{ background: notice?.tone === 'error' ? '#dc2626' : notice?.tone === 'warning' ? '#92400e' : '#ff385c' }}>
      <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
      {isPending ? 'Buscando…' : notice?.label ?? 'Gmail'}
      {complete ? <span className={`absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ${fresh ? 'bg-[#0f172a]' : 'bg-[#22c55e]'}`}>
        {fresh || '✓'}
      </span> : null}
    </button>
    {notice && notice.tone !== 'success' ? <Link href="/settings/gmail" aria-label="Ver conciliación" className="inline-flex min-h-9 items-center text-[11px] font-medium underline">Detalles</Link> : null}
  </div>
}
