'use client'
import { useState } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  addMonths, subMonths, format, isSameMonth, isToday,
} from 'date-fns'
import { es } from 'date-fns/locale'
import type { MaintenanceIssue } from '@/lib/types'

type SchedIssue = MaintenanceIssue & { property?: { name: string } }

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const DOT = { overdue: '#ef4444', soon: '#f97316', ok: '#22c55e', unknown: '#94a3b8' }
type Level = keyof typeof DOT
const RANK: Record<Level, number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 }

/** Prefer the real column; fall back to the legacy encoded description. */
function nextOf(i: SchedIssue): string | null {
  return i.next_due ?? (i.description?.match(/next:([0-9-]+)/)?.[1] ?? null)
}

function urgency(next: string | null): Level {
  if (!next) return 'unknown'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(next + 'T00:00:00')
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)  return 'overdue'
  if (diff <= 14) return 'soon'
  return 'ok'
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10)]} ${y}`
}

export function MaintenanceCalendar({ issues }: { issues: SchedIssue[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd   = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  // date-string → issues due that day
  const byDay = new Map<string, SchedIssue[]>()
  for (const i of issues) {
    const nd = nextOf(i)
    if (!nd) continue
    const list = byDay.get(nd) ?? []
    list.push(i)
    byDay.set(nd, list)
  }

  // Items due in the visible month, sorted by date
  const monthItems = issues
    .map(i => ({ i, nd: nextOf(i) }))
    .filter((x): x is { i: SchedIssue; nd: string } =>
      x.nd != null && isSameMonth(new Date(x.nd + 'T12:00:00'), month))
    .sort((a, b) => a.nd.localeCompare(b.nd))

  return (
    <div className="space-y-4">

      {/* Month navigator */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-[#e2e8f0] px-4 py-3 shadow-sm">
        <button
          onClick={() => setMonth(m => startOfMonth(subMonths(m, 1)))}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6366f1] font-bold text-xl active:opacity-60"
        >‹</button>
        <p className="text-sm font-bold text-[#0f172a] capitalize">
          {format(month, 'MMMM yyyy', { locale: es })}
        </p>
        <button
          onClick={() => setMonth(m => startOfMonth(addMonths(m, 1)))}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6366f1] font-bold text-xl active:opacity-60"
        >›</button>
      </div>

      {/* Month grid */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-2 shadow-sm">
        <div className="grid grid-cols-7">
          {WEEKDAYS.map(w => (
            <div key={w} className="text-center text-[10px] font-semibold text-[#cbd5e1] py-1">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map(d => {
            const ds      = format(d, 'yyyy-MM-dd')
            const items   = byDay.get(ds) ?? []
            const inMonth = isSameMonth(d, month)
            const today   = isToday(d)
            const level   = items.reduce<Level>((best, it) => {
              const l = urgency(nextOf(it))
              return RANK[l] < RANK[best] ? l : best
            }, 'unknown')
            return (
              <div
                key={ds}
                className={`aspect-square flex flex-col items-center justify-center rounded-lg
                  ${inMonth ? '' : 'opacity-30'} ${today ? 'bg-[#fffbeb]' : ''}`}
              >
                <span className={`text-[11px] ${today ? 'font-bold text-[#b45309]' : 'text-[#334155]'}`}>
                  {format(d, 'd')}
                </span>
                {items.length > 0 && (
                  <span className="mt-0.5 flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT[level] }} />
                    {items.length > 1 && <span className="text-[8px] font-bold text-[#94a3b8]">{items.length}</span>}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* This month's list */}
      {monthItems.length === 0 ? (
        <p className="text-center text-xs text-[#94a3b8] py-6 capitalize">
          Sin preventivos en {format(month, 'MMMM', { locale: es })}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide px-1">
            En {format(month, 'MMMM', { locale: es })} ({monthItems.length})
          </p>
          {monthItems.map(({ i, nd }) => {
            const level = urgency(nd)
            return (
              <div key={i.id} className="bg-white rounded-xl border border-[#e2e8f0] px-3 py-2 flex items-center gap-2.5 shadow-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOT[level] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0f172a] truncate">
                    {i.property?.name ?? '—'} · {i.title}
                  </p>
                  <p className="text-[11px] text-[#94a3b8]">{fmtDate(nd)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
