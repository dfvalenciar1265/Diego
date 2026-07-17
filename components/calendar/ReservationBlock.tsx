import { memo } from 'react'
import type { Reservation } from '@/lib/types'
import type { CSSProperties } from 'react'

interface Props {
  reservation: Reservation
  onClick: (r: Reservation) => void
  style?: CSSProperties
  /** Rendered bar width (px). Below ~62px we show initials instead of the full name. */
  width?: number
}

const SOURCE_COLORS: Record<string, string> = {
  airbnb: '#ff385c',
  direct: '#6366f1',
}
const BLOCKED_COLOR = '#94a3b8'

/** "María García" → "MG" (first letters of the first two words). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// Memoized: a reservation bar only needs to re-render if its own data,
// position, or click handler change — not when the calendar's form state does.
export const ReservationBlock = memo(function ReservationBlock({ reservation, onClick, style, width }: Props) {
  // Blocked is a STATUS, not a source — colour it grey regardless of source, so the
  // legend's grey "Bloqueado" swatch actually matches what's on screen.
  const blocked = reservation.status === 'blocked'
  const bg = blocked ? BLOCKED_COLOR : (SOURCE_COLORS[reservation.source] ?? SOURCE_COLORS.direct)

  // Source cue that survives colour-blindness and tiny bars: A = Airbnb, D = Directa.
  const srcMark = reservation.source === 'airbnb' ? 'A' : 'D'
  const narrow  = width != null && width < 62
  const label   = blocked
    ? '🚫 Bloqueado'
    : (narrow ? initialsOf(reservation.guest_name) : reservation.guest_name)

  return (
    <button
      onClick={() => onClick(reservation)}
      className="absolute top-1 bottom-1 rounded text-xs font-medium px-1
                 overflow-hidden text-left active:opacity-80 transition-opacity"
      style={{ backgroundColor: bg, color: 'white', ...style }}
    >
      <span className="flex items-center gap-0.5 truncate">
        {!blocked && <span className="text-[9px] font-bold opacity-70 shrink-0">{srcMark}</span>}
        <span className="truncate">{label}</span>
      </span>
    </button>
  )
})
