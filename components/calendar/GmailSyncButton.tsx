'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { syncGmail } from '@/actions/gmail'

export function GmailSyncButton() {
  const [isPending, startTransition] = useTransition()
  const [badge, setBadge] = useState<number | null>(null)

  function handleSync() {
    setBadge(null)
    startTransition(async () => {
      const result = await syncGmail()
      if (result.ok) setBadge(result.new_count ?? 0)
    })
  }

  return (
    <button
      onClick={handleSync}
      disabled={isPending}
      title="Sincronizar Gmail"
      className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
      style={{ background: '#ff385c' }}
    >
      <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
      {isPending ? 'Sync…' : 'Gmail'}
      {badge !== null && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center bg-[#0f172a] text-white">
          {badge}
        </span>
      )}
    </button>
  )
}
