'use client'
import { useTransition } from 'react'
import { resolvePurchaseRequest } from '@/actions/purchases'
import { toast } from '@/components/ui/feedback'

export function ResolvePurchaseButton({ id, description }: { id: string; description?: string }) {
  const [isPending, startTransition] = useTransition()

  function resolve() {
    startTransition(async () => {
      try {
        await resolvePurchaseRequest(id)
        // No «Deshacer»: there is no action to reopen a purchase request yet
        toast.success(description ? `Comprado: ${description}` : 'Compra marcada como resuelta')
      } catch {
        toast.error('No se pudo marcar la compra. Revisa tu conexión.')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={resolve}
      disabled={isPending}
      aria-label={description ? `Marcar como comprado: ${description}` : 'Marcar solicitud como comprada'}
      className="min-h-11 text-sm bg-[#22c55e] text-white px-3 rounded-lg
                 font-medium disabled:opacity-50 active:opacity-80 flex-shrink-0">
      {isPending ? '…' : '✓ Comprado'}
    </button>
  )
}
