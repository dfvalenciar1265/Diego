'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { syncGmail } from '@/actions/gmail'
import { toast } from '@/components/ui/feedback'

type SyncState = 'idle' | 'ok' | 'error'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "2 reservas nuevas y 1 actualizada" / "Sin reservas nuevas" */
function summary(newCount: number, updatedCount: number): string {
  const parts: string[] = []
  if (newCount > 0) parts.push(plural(newCount, 'reserva nueva', 'reservas nuevas'))
  if (updatedCount > 0) {
    parts.push(newCount > 0
      ? plural(updatedCount, 'actualizada', 'actualizadas')
      : plural(updatedCount, 'reserva actualizada', 'reservas actualizadas'))
  }
  return parts.length > 0 ? parts.join(' y ') : 'Sin reservas nuevas'
}

export function GmailSyncButton() {
  const [isPending, startTransition] = useTransition()
  const [newCount, setNewCount]     = useState<number | null>(null)
  const [state, setState]           = useState<SyncState>('idle')
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)

  function fail(message: string) {
    setState('error')
    setErrorMsg(message)
    toast.error(`No se pudo sincronizar Gmail: ${message}`)
  }

  function handleSync() {
    setNewCount(null)
    setState('idle')
    setErrorMsg(null)
    startTransition(async () => {
      try {
        const result = await syncGmail()
        if (result.ok) {
          const fresh = result.new_count ?? 0
          const updated = result.updated_count ?? 0
          setState('ok')
          setNewCount(fresh)
          toast.success(`Gmail sincronizado: ${summary(fresh, updated)}`)
        } else {
          fail(result.error ?? 'Error desconocido')
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Error de conexión')
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
        className="relative flex items-center gap-1.5 px-3 h-9 whitespace-nowrap rounded-xl text-xs font-semibold text-white disabled:opacity-60 transition-colors"
        style={{ background: bgColor }}
      >
        <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
        {isPending ? 'Buscando…' : state === 'error' ? '⚠ Error' : 'Gmail'}

        {/* Badge: new reservations found */}
        {state === 'ok' && newCount !== null && newCount > 0 && (
          <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center bg-[#0f172a] text-white">
            {newCount}
          </span>
        )}

        {/* Badge: 0 new (checkmark) */}
        {state === 'ok' && newCount === 0 && (
          <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center bg-[#22c55e] text-white">
            ✓
          </span>
        )}
      </button>

      {/* Error detail shown below button */}
      {state === 'error' && errorMsg && (
        <p className="text-[11px] text-[#ef4444] max-w-[180px] text-right leading-tight">
          {errorMsg}
        </p>
      )}
    </div>
  )
}
