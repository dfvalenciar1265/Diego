'use client'
import { useState } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, format, isSameMonth, isToday,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useUserRole } from '@/lib/user-context'
import type { Property, Reservation } from '@/lib/types'

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const SRC: Record<string, string> = { airbnb: '#ff385c', direct: '#6366f1' }
const BLOCKED = '#94a3b8'
const WEEK_H = 58   // px per week row

const toStr = (d: Date) => format(d, 'yyyy-MM-dd')

interface Props {
  property: Property | null
  reservations: Reservation[]
  onClose: () => void
  /** Tap a reservation bar (admins only) → open it to edit. */
  onSelect: (r: Reservation) => void
}

/**
 * Airbnb-style month calendar for a single apartment: reservations render as
 * bars spanning their nights across the week rows (half-cell wedges on
 * check-in/check-out), split automatically when a stay crosses a week boundary.
 */
export function PropertyReservationsSheet({ property, reservations, onClose, onSelect }: Props) {
  const role    = useUserRole()
  const canEdit = role === 'admin'
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const todayStr = toStr(new Date())

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd   = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const allDays   = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const weeks: Date[][] = []
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7))

  return (
    <Sheet open={property != null} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl"
        style={{ height: '90dvh', overflowY: 'auto', padding: '1rem 0.75rem env(safe-area-inset-bottom,1rem)' }}
      >
        <SheetHeader className="mb-2 px-1">
          <SheetTitle className="truncate">{property?.name ?? ''}</SheetTitle>
        </SheetHeader>

        {/* Month navigator */}
        <div className="flex items-center justify-between px-1 mb-2">
          <button
            onClick={() => setMonth(m => startOfMonth(subMonths(m, 1)))}
            className="w-9 h-9 flex items-center justify-center text-[#6366f1] text-xl active:opacity-60"
            aria-label="Mes anterior"
          >‹</button>
          <p className="text-sm font-bold capitalize text-[#0f172a]">
            {format(month, 'MMMM yyyy', { locale: es })}
          </p>
          <button
            onClick={() => setMonth(m => startOfMonth(addMonths(m, 1)))}
            className="w-9 h-9 flex items-center justify-center text-[#6366f1] text-xl active:opacity-60"
            aria-label="Mes siguiente"
          >›</button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-[#e2e8f0]">
          {WEEKDAYS.map(w => (
            <div key={w} className="text-center text-[10px] font-semibold text-[#94a3b8] py-1">{w}</div>
          ))}
        </div>

        {/* Weeks */}
        <div>
          {weeks.map((week, wi) => {
            const ws = week.map(toStr)
            const first = ws[0], last = ws[6]

            // Reservation → bar segment clamped to this week (or [] if it doesn't touch it)
            const segments = reservations.flatMap(r => {
              if (r.check_out < first || r.check_in > last) return []
              const inCI      = r.check_in >= first
              const startCol  = inCI ? Math.max(0, ws.indexOf(r.check_in)) : 0
              const startFrac = startCol + (inCI ? 0.5 : 0)        // arrive mid-day
              const inCO      = r.check_out <= last
              const endFrac   = inCO ? Math.max(0, ws.indexOf(r.check_out)) + 0.5 : 7   // leave mid-day
              if (endFrac <= startFrac) return []
              return [{
                r,
                leftPct:  (startFrac / 7) * 100,
                widthPct: ((endFrac - startFrac) / 7) * 100,
                roundL:   inCI,
                roundR:   inCO,
              }]
            })

            return (
              <div key={wi} className="relative border-b border-[#e2e8f0]" style={{ height: WEEK_H }}>
                {/* Day cells */}
                <div className="grid grid-cols-7 h-full">
                  {week.map(d => {
                    const inMonth = isSameMonth(d, month)
                    const today   = isToday(d)
                    return (
                      <div key={toStr(d)} className="border-r border-[#cbd5e1] last:border-r-0 pt-1 flex justify-center">
                        <span
                          className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full
                            ${today ? 'bg-[#f59e0b] text-white font-bold' : inMonth ? 'text-[#334155]' : 'text-[#cbd5e1]'}`}
                        >
                          {format(d, 'd')}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Reservation bars — a distinct rounded pill per stay, with a gap on
                    the real check-in/check-out ends so consecutive reservations
                    (a same-day turnover) read as two separate pills, not one blob. */}
                {segments.map((s, i) => {
                  const blocked = s.r.status === 'blocked'
                  const bg      = blocked ? BLOCKED : (SRC[s.r.source] ?? SRC.direct)
                  const isPast  = s.r.check_out < todayStr
                  const gapL    = s.roundL ? 3 : 0    // space at the real check-in end
                  const gapR    = s.roundR ? 3 : 0    // space at the real check-out end
                  return (
                    <button
                      key={s.r.id + '-' + i}
                      onClick={() => canEdit && onSelect(s.r)}
                      disabled={!canEdit}
                      className="absolute h-[24px] pl-2 pr-1.5 text-left overflow-hidden active:opacity-70 flex items-center gap-1"
                      style={{
                        left:  `calc(${s.leftPct}% + ${gapL}px)`,
                        width: `calc(${s.widthPct}% - ${gapL + gapR}px)`,
                        top: 25,
                        background: bg,
                        color: 'white',
                        borderRadius: `${s.roundL ? 12 : 3}px ${s.roundR ? 12 : 3}px ${s.roundR ? 12 : 3}px ${s.roundL ? 12 : 3}px`,
                        opacity: isPast ? 0.55 : 1,
                      }}
                    >
                      {/* arrival dot marks where the stay begins (like Airbnb) */}
                      {s.roundL && <span className="w-1.5 h-1.5 rounded-full bg-white/90 shrink-0" />}
                      <span className="text-[10px] font-semibold truncate">
                        {blocked ? '🚫 Bloqueado' : s.r.guest_name}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {canEdit && (
          <p className="text-[10px] text-[#94a3b8] text-center mt-3">Tocá una reserva para ver o editarla</p>
        )}
      </SheetContent>
    </Sheet>
  )
}
