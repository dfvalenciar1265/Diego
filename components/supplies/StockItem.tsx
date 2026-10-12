'use client'
import { useState, useTransition } from 'react'
import { updateStock } from '@/actions/supplies'
import type { PropertySupply } from '@/lib/types'
import { toast } from '@/components/ui/feedback'

interface Props {
  item: PropertySupply & { supply?: { name: string; unit: string } }
}

export function StockItem({ item }: Props) {
  const [qty, setQty] = useState(item.current_qty)
  const [isPending, startTransition] = useTransition()
  const isLow = qty <= item.min_qty

  function changeQty(delta: number) {
    const before = qty
    const newQty = Math.max(0, qty + delta)
    setQty(newQty)
    const name = item.supply?.name ?? 'Insumo'
    startTransition(async () => {
      try {
        await updateStock(item.id, delta)
        // Same id → repeated taps update one toast instead of stacking
        toast.success(`${name}: ${newQty} ${item.supply?.unit ?? ''}`.trim(), { id: `stock-${item.id}` })
      } catch {
        setQty(before)
        toast.error(`No se guardó el stock de ${name}`, { id: `stock-${item.id}` })
      }
    })
  }

  return (
    <div className={`flex items-center gap-3 py-3 border-b border-[#f1f5f9] last:border-0
                     ${isLow ? 'bg-[#fff5f5] -mx-4 px-4 rounded-lg' : ''}`}>
      <div className="flex-1">
        <p className="text-sm font-medium text-[#0f172a]">{item.supply?.name}</p>
        <p className="text-xs text-[#64748b]">
          Mínimo: {item.min_qty} {item.supply?.unit}
          {isLow && <span className="text-[#ef4444] font-semibold ml-2">⚠️ Stock bajo</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => changeQty(-1)}
          disabled={isPending || qty === 0}
          aria-label={`Reducir ${item.supply?.name}`}
          className="w-11 h-11 rounded-lg bg-[#f1f5f9] text-lg text-[#0f172a] font-bold
                     disabled:opacity-40 active:bg-[#e2e8f0]">
          −
        </button>
        <span className={`w-8 text-center text-sm font-bold
                          ${isLow ? 'text-[#ef4444]' : 'text-[#0f172a]'}`}>
          {qty}
        </span>
        <button
          onClick={() => changeQty(+1)}
          disabled={isPending}
          aria-label={`Aumentar ${item.supply?.name}`}
          className="w-11 h-11 rounded-lg bg-[#f1f5f9] text-lg text-[#0f172a] font-bold
                     disabled:opacity-40 active:bg-[#e2e8f0]">
          +
        </button>
      </div>
    </div>
  )
}
