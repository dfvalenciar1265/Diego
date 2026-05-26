'use client'
import { useTransition } from 'react'
import { resolvePurchaseRequest } from '@/actions/purchases'

export function ResolvePurchaseButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()
  return (
    <button
      onClick={() => startTransition(() => resolvePurchaseRequest(id))}
      disabled={isPending}
      aria-label="Marcar solicitud como comprada"
      className="text-xs bg-[#22c55e] text-white px-3 py-1.5 rounded-lg
                 font-medium disabled:opacity-50 active:opacity-80 flex-shrink-0">
      {isPending ? '...' : '✓ Comprado'}
    </button>
  )
}
