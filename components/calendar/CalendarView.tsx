'use client'
import { useState, useMemo } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, isToday, isSameMonth, differenceInDays, parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
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

  // Two consecutive months
  const month1 = baseMonth
  const month2 = startOfMonth(addMonths(baseMonth, 1))

  const days = eachDayOfInterval({
    start: startOfMonth(month1),
    end:   endOfMonth(month2),
  })

  const firstDayStr = format(days[0], 'yyyy-MM-dd')
  const lastDayStr  = format(days[days.length - 1], 'yyyy-MM-dd')

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

  function openNew(propertyId: string) {
    setSelectedReservation(null)
    setSelectedPropertyId(propertyId)
    setFormOpen(true)
  }
  function openEdit(res: Reservation) {
    setSelectedReservation(res)
    setSelectedPropertyId(res.property_id)
    setFormOpen(true)
  }
  function handleClose() {
    setFormOpen(false)
    setSelectedReservation(null)
    setSelectedPropertyId('')
  }

  const totalW = PROP_W + days.length * DAY_W

  // Month segment labels for the header
  const segments = [month1, month2].map(m => ({
    label: format(m, 'MMMM yyyy', { locale: es }),
    count: eachDayOfInterval({ start: startOfMonth(m), end: endOfMonth(m) }).length,
  }))

  /**
   * Converts a reservation into absolute pixel coordinates within a property row.
   *
   * Returns null if the reservation has no overlap with the visible date range.
   *
   * isCI = check-in day is visible → left side gets a 2 px inset + rounded corner
   * isCO = check-out day falls within the visible range → right side gets a 2 px
   *        inset + rounded corner; otherwise the bar bleeds to the grid's right edge
   */
  function reservationLayout(res: Reservation) {
    const { check_in: ciStr, check_out: coStr } = res

    // Completely outside the visible range
    if (coStr <= firstDayStr || ciStr > lastDayStr) return null

    const isCI = ciStr >= firstDayStr   // check-in is visible
    const isCO = coStr <= lastDayStr    // check-out day is within visible range

    // Day-index offsets (relative to days[0])
    const startOffset = isCI
      ? differenceInDays(parseISO(ciStr), parseISO(firstDayStr))
      : 0
    const endOffset = isCO
      ? differenceInDays(parseISO(coStr), parseISO(firstDayStr))
      : days.length

    const nightCount = endOffset - startOffset
    if (nightCount <= 0) return null

    // Small insets at visible edges so the bar doesn't touch cell borders
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
    <div className="overflow-x-auto pb-4">

      {/* ── Month navigation (sticky so it doesn't scroll away) ──────────── */}
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

      {/* ── Scrollable grid ───────────────────────────────────────────────── */}
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
              {/* ── Sticky property-name cell ─────────────────────────────── */}
              <div
                className="flex-shrink-0 flex items-center px-2 bg-white border-r border-[#e2e8f0] sticky left-0 z-10"
                style={{ width: PROP_W }}
              >
                <p className="text-[11px] font-medium text-[#0f172a] leading-tight line-clamp-2">
                  {property.name}
                </p>
              </div>

              {/* ── Day cells — click targets only (empty days open new form) */}
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
                    onClick={() => openNew(property.id)}
                  />
                )
              })}

              {/* ── Reservation bars — one element spanning all nights ────── */}
              {propReservations.map(res => {
                const layout = reservationLayout(res)
                if (!layout) return null
                const { left, width, isCI, isCO } = layout

                return (
                  <ReservationBlock
                    key={res.id}
                    reservation={res}
                    onClick={openEdit}
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

      {/* ── Legend ───────────────────────────────────────────────────────── */}
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

      <ReservationForm
        open={formOpen}
        onClose={handleClose}
        reservation={selectedReservation ?? undefined}
        propertyId={selectedPropertyId}
        properties={properties}
      />
    </div>
  )
}
