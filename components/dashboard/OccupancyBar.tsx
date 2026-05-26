interface Props {
  name: string
  occupied: number
  total: number
}

export function OccupancyBar({ name, occupied, total }: Props) {
  const pct = total > 0 ? (occupied / total) * 100 : 0
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f97316' : '#ef4444'

  return (
    <div className="flex items-center gap-3">
      <p className="text-xs text-[#64748b] w-20 truncate flex-shrink-0">{name}</p>
      <div className="flex-1 h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-[#94a3b8] w-8 text-right flex-shrink-0">
        {occupied}/{total}
      </p>
    </div>
  )
}
