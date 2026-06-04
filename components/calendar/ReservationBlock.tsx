import { memo } from 'react'
import type { Reservation } from '@/lib/types'
import type { CSSProperties } from 'react'

interface Props {
  reservation: Reservation
  onClick: (r: Reservation) => void
  style?: CSSProperties
}

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  airbnb: { bg: '#ff385c', text: 'white' },
  direct: { bg: '#6366f1', text: 'white' },
  blocked: { bg: '#94a3b8', text: 'white' },
}

// Memoized: a reservation bar only needs to re-render if its own data,
// position, or click handler change — not when the calendar's form state does.
export const ReservationBlock = memo(function ReservationBlock({ reservation, onClick, style }: Props) {
  const colors = SOURCE_COLORS[reservation.source] ?? SOURCE_COLORS.direct

  return (
    <button
      onClick={() => onClick(reservation)}
      className="absolute top-1 bottom-1 rounded text-xs font-medium px-1
                 overflow-hidden text-left active:opacity-80 transition-opacity"
      style={{ backgroundColor: colors.bg, color: colors.text, ...style }}
    >
      <span className="truncate block">
        {reservation.status === 'blocked' ? '🚫 Bloqueado' : reservation.guest_name}
      </span>
    </button>
  )
})
