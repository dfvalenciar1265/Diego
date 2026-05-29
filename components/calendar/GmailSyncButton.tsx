'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { syncGmail } from '@/actions/gmail'

type SyncState = 'idle' | 'ok' | 'error'

export function GmailSyncButton() {
  const [isPending, startTransition] = useTransition()
  const [newCount, setNewCount]     = useState<number | null>(null)
  const [state, setState]           = useState<SyncState>('idle')
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)

  function handleSync() {
    setNewCount(null)
    setState('idle')
    setErrorMsg(null)
    startTransition(async () => {
      try {
        const result = await syncGmail()
        if (result.ok) {
          setState('ok')
          setNewCount(result.new_count ?? 0)
        } else {
          setState('error')
          setErrorMsg(result.error ?? 'Error desconocido')
        }
      } catch (e) {
        setState('error')
        setErrorMsg(e instanceof Error ? e.message : 'Error de conexión')
      }
    })
  }

  const bgColor = state === 'error' ? '#ef4444' : '#ff385c'

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSync}
        disabled={isPending}
        title="Sincronizar Gmail"
        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60 transition-colors"
        style={{ background: bgColor }}
      >
        <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
        {isPending ? 'Sync…' : state === 'error' ? '⚠ Error' : 'Gmail'}

        {/* Badge: new reservations found */}
        {state === 'ok' && newCount !== null && newCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center bg-[#0f172a] text-white">
            {newCount}
          </span>
        )}

        {/* Badge: 0 new (checkmark) */}
        {state === 'ok' && newCount === 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center bg-[#22c55e] text-white">
            ✓
          </span>
        )}
      </button>

      {/* Error detail shown below button */}
      {state === 'error' && errorMsg && (
        <p className="text-[10px] text-[#ef4444] max-w-[180px] text-right leading-tight">
          {errorMsg}
        </p>
      )}
    </div>
  )
}
