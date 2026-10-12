'use client'
import { useState, useMemo, useEffect, useRef, useCallback, useSyncExternalStore, memo } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, subDays, isToday, isSameMonth,
  differenceInDays, parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import type { Property, Reservation } from '@/lib/types'
import { canDo } from '@/lib/permissions'
import { useUserRole } from '@/lib/user-context'
import { ReservationBlock } from './ReservationBlock'
import { ReservationForm } from './ReservationForm'
import { PropertyReservationsSheet } from './PropertyReservationsSheet'

// ── Layout constants ──────────────────────────────────────────────────────────
const PROP_W_PHONE   = 90    // sticky property-name column width (px) on phones
const PROP_W_DESKTOP = 184   // md+: room for "Cartagena Beach Crespo 1214" without cutting it
const DAY_W   = 36    // each day column width (px)
const ROW_H   = 40    // row height (px)
const TODAY_C = '#f59e0b'  // amber — reserved for "today" only (never red/indigo/grey)

// Weekday initial by getDay() (0=Sun): the Colombian L M X J V S D convention.
const WEEKDAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

// md+ (sidebar layout) → wider name column. Server/first paint assume phone.
const DESKTOP_MQ = '(min-width: 768px)'
function subscribeDesktop(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_MQ)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_MQ).matches, () => false)
}

interface Props {
  properties: Property[]
  reservations: Reservation[]
}

export function CalendarView({ properties, reservations }: Props) {
  const [baseMonth, setBaseMonth] = useState(() => startOfMonth(new Date()))
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)
  const [formOpen, setFormOpen]   = useState(false)
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [listProperty, setListProperty] = useState<Property | null>(null)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const role    = useUserRole()
  const canEdit = role != null && canDo(role, 'reservations:edit')   // admin only — gates create affordances
  const propW   = useIsDesktop() ? PROP_W_DESKTOP : PROP_W_PHONE

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
      segments: [month1, month2].map(m => ({
        label: format(m, 'MMMM yyyy', { locale: es }),
        count: eachDayOfInterval({ start: startOfMonth(m), end: endOfMonth(m) }).length,
      })),
    }
  }, [baseMonth])
  const { month1, month2, days } = grid
  const totalW = propW + days.length * DAY_W

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

  // "Hoy" button: jump the window to the current month AND centre today on screen.
  // The scroll must happen after the grid re-renders with the new days, so it's
  // deferred to this effect and gated by a ref (so plain month navigation never
  // triggers an unwanted scroll).
  const goTodayPending = useRef(false)
  useEffect(() => {
    if (!goTodayPending.current) return
    goTodayPending.current = false
    const el = scrollRef.current
    if (!el) return
    const idx = days.findIndex(d => isToday(d))
    if (idx < 0) return
    const target = propW + idx * DAY_W - (el.clientWidth - propW) / 2
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [days, propW])
  const goToday = useCallback(() => {
    goTodayPending.current = true
    setBaseMonth(startOfMonth(new Date()))
  }, [])

  // ── Guest search ────────────────────────────────────────────────────────────
  // All reservations are already in memory, so this is instant and accent-blind
  // ("jose" finds "José"). Picking a result jumps the calendar to its month.
  const propName = useMemo(() => new Map(properties.map(p => [p.id, p.name])), [properties])
  const results = useMemo(() => {
    // NFD + strip combining marks → "José" and "Jose" both become "jose"
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const q = norm(query.trim())
    if (q.length < 2) return []
    return reservations
      .filter(r => norm(r.guest_name ?? '').includes(q))
      .sort((a, b) => b.check_in.localeCompare(a.check_in))
      .slice(0, 8)
  }, [query, reservations])
  const shortD = (iso: string) => format(parseISO(iso), 'd MMM', { locale: es })

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
  // Tapping an apartment name opens the list of that apartment's reservations.
  const openList = useCallback((p: Property) => setListProperty(p), [])
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

  function selectResult(r: Reservation) {
    setBaseMonth(startOfMonth(parseISO(r.check_in)))
    setQuery('')
    openEdit(r)
  }

  return (
    <div className="relative">

      {/* ── Buscar reserva por huésped ──────────────────────────────────────── */}
      <div className="px-4 pt-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar reserva por huésped…"
            aria-label="Buscar reserva por huésped"
            className="w-full h-11 text-sm bg-white border border-[#e2e8f0] rounded-xl pl-9 pr-11
                       focus:outline-none focus:ring-1 focus:ring-[#6366f1] placeholder:text-[#64748b]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-0 top-0 w-11 h-11 flex items-center justify-center rounded-xl
                         text-[#64748b] text-sm hover:text-[#0f172a] active:opacity-60"
              aria-label="Limpiar búsqueda"
            >✕</button>
          )}
        </div>

        {query.trim().length >= 2 && (
          <div className="mt-2 bg-white border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm">
            {results.length === 0 ? (
              <p className="px-3 py-3 text-xs text-[#64748b]">Sin reservas para “{query.trim()}”</p>
            ) : results.map(r => (
              <button
                key={r.id}
                onClick={() => selectResult(r)}
                className="w-full text-left px-3 py-2.5 border-b border-[#f1f5f9] last:border-0 active:bg-[#f8fafc]"
              >
                <p className="text-xs font-semibold text-[#0f172a] truncate">
                  {r.status === 'blocked' ? '🚫 Bloqueado' : (r.guest_name || '—')}
                </p>
                <p className="text-[11px] text-[#64748b] truncate">
                  {propName.get(r.property_id) ?? '—'} · {shortD(r.check_in)} → {shortD(r.check_out)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-4">

        {/* ── Month navigation ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 sticky left-0 bg-[#f8fafc] z-20">
          <button
            onClick={() => setBaseMonth(m => startOfMonth(subMonths(m, 1)))}
            className="w-11 h-11 flex items-center justify-center rounded-full text-[#64748b] text-2xl
                       hover:text-[#0f172a] hover:bg-white transition-colors"
            aria-label="Mes anterior"
          >‹</button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-[#0f172a] capitalize text-sm truncate">
              {format(month1, 'MMMM yyyy', { locale: es })}
              {' — '}
              {format(month2, 'MMMM yyyy', { locale: es })}
            </span>
            {/* 44px tap area around a compact pill */}
            <button
              onClick={goToday}
              className="shrink-0 h-11 px-1 flex items-center active:opacity-70"
              aria-label="Ir a hoy"
            >
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full border"
                style={{ color: '#b45309', borderColor: TODAY_C, background: '#fffbeb' }}
              >
                Hoy
              </span>
            </button>
          </div>
          <button
            onClick={() => setBaseMonth(m => startOfMonth(addMonths(m, 1)))}
            className="w-11 h-11 flex items-center justify-center rounded-full text-[#64748b] text-2xl
                       hover:text-[#0f172a] hover:bg-white transition-colors"
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
          propW={propW}
          firstDayStr={grid.firstDayStr}
          lastDayStr={grid.lastDayStr}
          canEdit={canEdit}
          onCellClick={openNew}
          onReservationClick={openEdit}
          onPropertyClick={openList}
        />

        {/* Legend */}
        <div className="flex gap-4 px-4 pt-3 sticky left-0">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#ff385c]" />
            <span className="text-xs text-[#64748b]">Airbnb</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#6366f1]" />
            <span className="text-xs text-[#64748b]">Directa</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#94a3b8]" />
            <span className="text-xs text-[#64748b]">Bloqueado</span>
          </div>
        </div>
      </div>

      {/* ── Floating "Nueva reserva" button (admins only) ────────────────── */}
      {canEdit && (
        <button
          onClick={openNewDirect}
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 md:bottom-8 md:right-8 z-30 w-14 h-14 rounded-full shadow-lg
                     flex items-center justify-center transition-transform active:scale-95"
          style={{ background: '#6366f1' }}
          aria-label="Nueva reserva directa"
        >
          <Plus size={26} color="white" strokeWidth={2.5} />
        </button>
      )}

      <ReservationForm
        open={formOpen}
        onClose={handleClose}
        reservation={selectedReservation ?? undefined}
        propertyId={selectedPropertyId}
        properties={properties}
        defaultSource={selectedReservation ? undefined : 'direct'}
      />

      {/* Reservas del apartamento — se abre al tocar el nombre del apto */}
      <PropertyReservationsSheet
        property={listProperty}
        reservations={listProperty ? (byProp.get(listProperty.id) ?? []) : []}
        onClose={() => setListProperty(null)}
        onSelect={res => { setListProperty(null); openEdit(res) }}
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
  /** Width of the sticky apartment-name column (wider on desktop). */
  propW:        number
  firstDayStr:  string
  lastDayStr:   string
  canEdit:      boolean
  onCellClick:        (propertyId: string) => void
  onReservationClick: (res: Reservation) => void
  onPropertyClick:    (property: Property) => void
}

const CalendarGrid = memo(function CalendarGrid({
  properties, byProp, month1, days, segments, totalW, propW,
  firstDayStr, lastDayStr, canEdit, onCellClick, onReservationClick, onPropertyClick,
}: GridProps) {
  const todayOffset = days.findIndex(d => isToday(d))
  // Keyboard: one tab stop per row (today's cell, else the first day); ←/→ move along the
  // row and Enter/Space opens "nueva reserva" — instead of ~600 tab stops.
  const focusCol = todayOffset >= 0 ? todayOffset : 0

  function onCellKeyDown(e: React.KeyboardEvent<HTMLDivElement>, propertyId: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCellClick(propertyId)
      return
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight'
      ? e.currentTarget.nextElementSibling
      : e.currentTarget.previousElementSibling
    if (next instanceof HTMLElement && next.dataset.cell !== undefined) next.focus()
  }

  /**
   * Reservation → absolute pixel coordinates within a property row, or null.
   * Guests arrive/leave mid-day, so the bar starts at the middle of the check-in
   * cell and ends at the middle of the check-out cell (half-cell wedges). This
   * makes arrival vs departure obvious and lets a same-day turnover show as
   * departure (left half) meeting arrival (right half) in one cell.
   */
  function reservationLayout(res: Reservation) {
    const { check_in: ciStr, check_out: coStr } = res
    if (coStr <= firstDayStr || ciStr > lastDayStr) return null

    const isCI = ciStr >= firstDayStr
    const isCO = coStr <= lastDayStr

    const startOffset = isCI ? differenceInDays(parseISO(ciStr), parseISO(firstDayStr)) : 0
    const endOffset   = isCO ? differenceInDays(parseISO(coStr), parseISO(firstDayStr)) : days.length
    if (endOffset - startOffset <= 0) return null

    const GAP  = 1
    const left  = propW + startOffset * DAY_W + (isCI ? DAY_W / 2 : 0) + GAP
    const right = propW + endOffset   * DAY_W + (isCO ? DAY_W / 2 : 0) - GAP
    const width = right - left
    if (width <= 0) return null

    return { left, width, isCI, isCO }
  }

  return (
    <div className="relative" style={{ minWidth: totalW }}>

      {/* Month labels row */}
      <div className="flex" style={{ marginLeft: propW }}>
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

      {/* Weekday + day-number header row */}
      <div className="flex" style={{ marginLeft: propW }}>
        {days.map(day => {
          const today = isToday(day)
          const wknd  = isWeekend(day)
          return (
            <div
              key={day.toISOString()}
              className="flex-shrink-0 flex flex-col items-center py-1"
              style={{ width: DAY_W, background: wknd && !today ? '#f8fafc' : undefined }}
            >
              <span className={`text-[10px] font-semibold uppercase leading-none mb-0.5
                               ${today ? 'text-[#b45309]' : 'text-[#64748b]'}`}>
                {WEEKDAY[day.getDay()]}
              </span>
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-medium
                  ${today ? 'bg-[#f59e0b] text-white' : wknd ? 'text-[#64748b]' : 'text-[#0f172a]'}`}
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
            {/* Sticky property-name cell — tap to see this apartment's reservations */}
            <button
              onClick={() => onPropertyClick(property)}
              className="flex-shrink-0 flex items-center gap-0.5 px-2 md:px-3 bg-white border-r border-[#e2e8f0]
                         sticky left-0 z-10 text-left hover:bg-[#f8fafc] active:bg-[#f8fafc] transition-colors"
              style={{ width: propW }}
              title={property.name}
              aria-label={`Ver reservas de ${property.name}`}
            >
              <p className="text-[11px] md:text-xs font-medium text-[#0f172a] leading-tight line-clamp-2 flex-1 min-w-0">
                {property.name}
              </p>
              <span className="text-[#64748b] text-xs shrink-0" aria-hidden>›</span>
            </button>

            {/* Day cells — click targets (empty days open new reservation form for admins) */}
            {days.map((day, col) => {
              const today    = isToday(day)
              const wknd     = isWeekend(day)
              const monthSep = day.getDate() === 1 && !isSameMonth(day, month1)
              return (
                <div
                  key={day.toISOString()}
                  {...(canEdit && {
                    role: 'button',
                    tabIndex: col === focusCol ? 0 : -1,
                    'data-cell': '',
                    'aria-label': `Nueva reserva en ${property.name}, ${format(day, "EEEE d 'de' MMMM", { locale: es })}`,
                    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => onCellKeyDown(e, property.id),
                  })}
                  className={[
                    'flex-shrink-0 border-l',
                    canEdit ? 'cursor-pointer hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#6366f1]' : '',
                    today    ? 'bg-[#fffbeb] border-l-[#f59e0b] border-l-2'
                             : wknd ? 'bg-[#f8fafc] border-[#f1f5f9]'
                             : 'border-[#f1f5f9]',
                    monthSep ? 'border-l-[#e2e8f0] border-l-2' : '',
                  ].join(' ')}
                  // keep a focused cell from hiding under the sticky name column
                  style={{ width: DAY_W, height: ROW_H, scrollMarginLeft: propW }}
                  onClick={canEdit ? () => onCellClick(property.id) : undefined}
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
                  width={width}
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

      {/* Today marker — a full-height amber line + "HOY" pill, painted above the
          bars (own reserved colour) but below the sticky name column. */}
      {todayOffset >= 0 && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{ top: 0, bottom: 0, left: propW + todayOffset * DAY_W + DAY_W / 2 - 1, width: 2, background: TODAY_C }}
          />
          <div
            className="absolute pointer-events-none"
            style={{ top: 1, left: propW + todayOffset * DAY_W + DAY_W / 2, transform: 'translateX(-50%)' }}
          >
            <span className="text-[10px] leading-none font-bold text-white px-1 py-0.5 rounded" style={{ background: TODAY_C }}>
              HOY
            </span>
          </div>
        </>
      )}

      {properties.length === 0 && (
        <div className="text-center py-12 text-[#64748b] text-sm">
          No hay apartamentos registrados
        </div>
      )}
    </div>
  )
})
