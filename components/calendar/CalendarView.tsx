'use client'
import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, subDays, isToday, isSameMonth,
  differenceInDays, parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import type { Property, Reservation } from '@/lib/types'
import { ReservationBlock } from './ReservationBlock'
import { ReservationForm } from './ReservationForm'

// ── Layout constants ──────────────────────────────────────────────────────────
const PROP_W  = 90    // sticky property-name column width (px)
const DAY_W   = 36    // each day column width (px)
const ROW_H   = 40    // row height (px)

interface Props {
  properties: Property[]
  reservations: Reservation[]
}

export function CalendarView({ properties, reservations }: Props) {
  const [baseMonth, setBaseMonth] = useState(() => startOfMonth(new Date()))
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)
  const [formOpen, setFormOpen]   = useState(false)
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Date derivations (memoized: only recompute when the month changes) ──────
  const grid = useMemo(() => {
    const month1 = baseMonth
    const month2 = startOfMonth(addMonths(baseMonth, 1))
    const days = eachDayOfInterval({ start: startOfMonth(month1), end: endOfMonth(month2) })
    return {
      month1,
      month2,
      days,
      firstDayStr: format(days[0], 'yyyy-MM-dd'),
      lastDayStr:  format(days[days.length - 1], 'yyyy-MM-dd'),
      totalW: PROP_W + days.length * DAY_W,
      segments: [month1, month2].map(m => ({
        label: format(m, 'MMMM yyyy', { locale: es }),
        count: eachDayOfInterval({ start: startOfMonth(m), end: endOfMonth(m) }).length,
      })),
    }
  }, [baseMonth])
  const { month1, month2, days, totalW } = grid

  // On first mount, scroll horizontally so yesterday is the first visible column
  useEffect(() => {
    if (!scrollRef.current) return
    const yesterday = subDays(new Date(), 1)
    const yStr = format(yesterday, 'yyyy-MM-dd')
    const idx = days.findIndex(d => format(d, 'yyyy-MM-dd') === yStr)
    if (idx > 0) {
      scrollRef.current.scrollLeft = idx * DAY_W
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run only once on mount

  // Group reservations by property for fast lookup
  const byProp = useMemo(() => {
    const map = new Map<string, Reservation[]>()
    for (const r of reservations) {
      const list = map.get(r.property_id) ?? []
      list.push(r)
      map.set(r.property_id, list)
    }
    return map
  }, [reservations])

  // Stable handlers so the memoized grid doesn't re-render on form open/close
  const openNew = useCallback((propertyId: string) => {
    setSelectedReservation(null)
    setSelectedPropertyId(propertyId)
    setFormOpen(true)
  }, [])
  const openEdit = useCallback((res: Reservation) => {
    setSelectedReservation(res)
    setSelectedPropertyId(res.property_id)
    setFormOpen(true)
  }, [])
  function openNewDirect() {
    setSelectedReservation(null)
    setSelectedPropertyId(properties[0]?.id ?? '')
    setFormOpen(true)
  }
  function handleClose() {
    setFormOpen(false)
    setSelectedReservation(null)
    setSelectedPropertyId('')
  }

  return (
    <div className="relative">
      <div ref={scrollRef} className="overflow-x-auto pb-4">

        {/* ── Month navigation ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 sticky left-0 bg-[#f8fafc] z-20">
          <button
            onClick={() => setBaseMonth(m => startOfMonth(subMonths(m, 1)))}
            className="w-10 h-10 flex items-center justify-center text-[#94a3b8] text-xl hover:text-[#0f172a] transition-colors"
            aria-label="Mes anterior"
          >‹</button>
          <span className="font-semibold text-[#0f172a] capitalize text-sm">
            {format(month1, 'MMMM yyyy', { locale: es })}
            {' — '}
            {format(month2, 'MMMM yyyy', { locale: es })}
          </span>
          <button
            onClick={() => setBaseMonth(m => startOfMonth(addMonths(m, 1)))}
            className="w-10 h-10 flex items-center justify-center text-[#94a3b8] text-xl hover:text-[#0f172a] transition-colors"
            aria-label="Mes siguiente"
          >›</button>
        </div>

        {/* ── Scrollable grid (memoized — unaffected by form state) ──────────── */}
        <CalendarGrid
          properties={properties}
          byProp={byProp}
          month1={month1}
          days={days}
          segments={grid.segments}
          totalW={totalW}
          firstDayStr={grid.firstDayStr}
          lastDayStr={grid.lastDayStr}
          onCellClick={openNew}
          onReservationClick={openEdit}
        />

        {/* Legend */}
        <div className="flex gap-4 px-4 pt-3 sticky left-0">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#ff385c]" />
            <span className="text-xs text-[#94a3b8]">Airbnb</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#6366f1]" />
            <span className="text-xs text-[#94a3b8]">Directa</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#94a3b8]" />
            <span className="text-xs text-[#94a3b8]">Bloqueado</span>
          </div>
        </div>
      </div>

      {/* ── Floating "Nueva reserva" button ──────────────────────────────── */}
      <button
        onClick={openNewDirect}
        className="fixed bottom-[4.5rem] right-4 z-30 w-14 h-14 rounded-full shadow-lg
                   flex items-center justify-center transition-transform active:scale-95"
        style={{ background: '#6366f1' }}
        aria-label="Nueva reserva directa"
      >
        <Plus size={26} color="white" strokeWidth={2.5} />
      </button>

      <ReservationForm
        open={formOpen}
        onClose={handleClose}
        reservation={selectedReservation ?? undefined}
        propertyId={selectedPropertyId}
        properties={properties}
        defaultSource={selectedReservation ? undefined : 'direct'}
      />
    </div>
  )
}

// ── Memoized grid ──────────────────────────────────────────────────────────────
// Re-renders only when its data props change (month/reservations), NOT when the
// parent's form state toggles. Keeps opening/closing a reservation smooth on
// mobile even with ~480 day cells and many reservation bars.

interface GridProps {
  properties:   Property[]
  byProp:       Map<string, Reservation[]>
  month1:       Date
  days:         Date[]
  segments:     { label: string; count: number }[]
  totalW:       number
  firstDayStr:  string
  lastDayStr:   string
  onCellClick:        (propertyId: string) => void
  onReservationClick: (res: Reservation) => void
}

const CalendarGrid = memo(function CalendarGrid({
  properties, byProp, month1, days, segments, totalW,
  firstDayStr, lastDayStr, onCellClick, onReservationClick,
}: GridProps) {
  /** Reservation → absolute pixel coordinates within a property row, or null. */
  function reservationLayout(res: Reservation) {
    const { check_in: ciStr, check_out: coStr } = res
    if (coStr <= firstDayStr || ciStr > lastDayStr) return null

    const isCI = ciStr >= firstDayStr
    const isCO = coStr <= lastDayStr

    const startOffset = isCI ? differenceInDays(parseISO(ciStr), parseISO(firstDayStr)) : 0
    const endOffset   = isCO ? differenceInDays(parseISO(coStr), parseISO(firstDayStr)) : days.length

    const nightCount = endOffset - startOffset
    if (nightCount <= 0) return null

    const leftInset  = isCI ? 2 : 0
    const rightInset = isCO ? 2 : 0
    return {
      left:  PROP_W + startOffset * DAY_W + leftInset,
      width: nightCount * DAY_W - leftInset - rightInset,
      isCI,
      isCO,
    }
  }

  return (
    <div style={{ minWidth: totalW }}>

      {/* Month labels row */}
      <div className="flex" style={{ marginLeft: PROP_W }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            className="flex-shrink-0 text-center text-[11px] font-semibold text-[#64748b] py-1 capitalize border-l border-[#e2e8f0] first:border-l-0"
            style={{ width: seg.count * DAY_W }}
          >
            {seg.label}
          </div>
        ))}
      </div>

      {/* Day-number header row */}
      <div className="flex" style={{ marginLeft: PROP_W }}>
        {days.map(day => {
          const today = isToday(day)
          return (
            <div
              key={day.toISOString()}
              className="flex-shrink-0 flex items-center justify-center py-1"
              style={{ width: DAY_W }}
            >
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-medium
                  ${today ? 'bg-[#ff385c] text-white' : 'text-[#94a3b8]'}`}
              >
                {format(day, 'd')}
              </span>
            </div>
          )
        })}
      </div>

      {/* Property rows */}
      {properties.map(property => {
        const propReservations = byProp.get(property.id) ?? []
        return (
          <div
            key={property.id}
            className="flex items-stretch border-t border-[#f1f5f9] relative"
            style={{ height: ROW_H }}
          >
            {/* Sticky property-name cell */}
            <div
              className="flex-shrink-0 flex items-center px-2 bg-white border-r border-[#e2e8f0] sticky left-0 z-10"
              style={{ width: PROP_W }}
            >
              <p className="text-[11px] font-medium text-[#0f172a] leading-tight line-clamp-2">
                {property.name}
              </p>
            </div>

            {/* Day cells — click targets (empty days open new reservation form) */}
            {days.map(day => {
              const today    = isToday(day)
              const monthSep = day.getDate() === 1 && !isSameMonth(day, month1)
              return (
                <div
                  key={day.toISOString()}
                  className={[
                    'flex-shrink-0 border-l cursor-pointer',
                    today    ? 'bg-[#fff0f2] border-l-[#ff385c] border-l-2' : 'border-[#f1f5f9]',
                    monthSep ? 'border-l-[#e2e8f0] border-l-2' : '',
                  ].join(' ')}
                  style={{ width: DAY_W, height: ROW_H }}
                  onClick={() => onCellClick(property.id)}
                />
              )
            })}

            {/* Reservation bars — one element spanning all nights */}
            {propReservations.map(res => {
              const layout = reservationLayout(res)
              if (!layout) return null
              const { left, width, isCI, isCO } = layout
              return (
                <ReservationBlock
                  key={res.id}
                  reservation={res}
                  onClick={onReservationClick}
                  style={{
                    left,
                    width,
                    borderRadius: `${isCI ? 4 : 0}px ${isCO ? 4 : 0}px ${isCO ? 4 : 0}px ${isCI ? 4 : 0}px`,
                  }}
                />
              )
            })}
          </div>
        )
      })}

      {properties.length === 0 && (
        <div className="text-center py-12 text-[#94a3b8] text-sm">
          No hay apartamentos registrados
        </div>
      )}
    </div>
  )
})
