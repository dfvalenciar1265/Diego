import type { PropertySupply } from '@/lib/types'

interface Props {
  item: PropertySupply & {
    supply?: { name: string; unit: string }
    property?: { name: string }
  }
}

export function StockAlert({ item }: Props) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#f1f5f9] last:border-0">
      <span className="text-base">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#0f172a] truncate">
          {item.supply?.name} — {item.property?.name}
        </p>
        <p className="text-xs text-[#94a3b8]">
          Quedan {item.current_qty} {item.supply?.unit} (mín. {item.min_qty})
        </p>
      </div>
    </div>
  )
}
