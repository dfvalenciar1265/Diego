import { getPriorityLabel, getPriorityColor } from '@/lib/utils'
import type { MaintenancePriority } from '@/lib/types'

export function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  const color = getPriorityColor(priority)
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}22`, color }}>
      {getPriorityLabel(priority)}
    </span>
  )
}
