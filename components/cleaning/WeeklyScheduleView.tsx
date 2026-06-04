'use client'
import { useState, useTransition } from 'react'
import { getWeekCleaningSchedule, type WeekCleaningTask } from '@/actions/tasks'
import type { TeamMember } from '@/lib/types'

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function dayNum(iso: string): number {
  return parseInt(iso.split('-')[2], 10)
}
function fmtShort(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${parseInt(dd, 10)} ${MONTHS[parseInt(mm, 10) - 1]}`
}

interface Props {
  initialTasks:     WeekCleaningTask[]
  initialWeekStart: string   // Monday, YYYY-MM-DD
  staff:            TeamMember[]
  todayISO:         string
}

export function WeeklyScheduleView({ initialTasks, initialWeekStart, staff, todayISO }: Props) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [tasks, setTasks]         = useState(initialTasks)
  const [cleaner, setCleaner]     = useState('')   // filter by assignee name
  const [isPending, startTransition] = useTransition()

  function navigate(deltaWeeks: number) {
    const ws = addDays(weekStart, deltaWeeks * 7)
    setWeekStart(ws)
    startTransition(async () => setTasks(await getWeekCleaningSchedule(ws)))
  }

  const filtered = cleaner ? tasks.filter(t => t.assignee_name === cleaner) : tasks
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(weekStart, i)
    return { iso, label: DAY_NAMES[i], tasks: filtered.filter(t => t.scheduled_for === iso) }
  })
  const weekEnd = addDays(weekStart, 6)
  const total = filtered.length

  // Build a plain-text schedule and open WhatsApp's share sheet
  function shareWhatsApp() {
    const lines: string[] = [`🧹 Limpiezas ${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`]
    if (cleaner) lines.push(`👤 ${cleaner}`)
    lines.push('')
    for (const d of days) {
      if (d.tasks.length === 0) continue
      lines.push(`*${d.label} ${dayNum(d.iso)}*`)
      for (const t of d.tasks) {
        const who = t.assignee_name && !cleaner ? ` — ${t.assignee_name}` : ''
        lines.push(`• ${t.property_name} · ${t.checkout_time}${who}`)
      }
    }
    if (total === 0) lines.push('Sin limpiezas esta semana.')
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank')
  }

  const dropdownStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundPosition: 'right 12px center',
  }

  return (
    <div className="space-y-3">

      {/* Week navigator */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-[#e2e8f0] px-4 py-3 shadow-sm">
        <button onClick={() => navigate(-1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6366f1] font-bold text-xl active:opacity-60">‹</button>
        <div className="text-center">
          <p className="text-sm font-bold text-[#0f172a]">
            {isPending ? '…' : `${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`}
          </p>
          <p className="text-[10px] text-[#94a3b8] uppercase tracking-wide">
            {total} limpieza{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => navigate(1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6366f1] font-bold text-xl active:opacity-60">›</button>
      </div>

      {/* Cleaner filter + WhatsApp share */}
      <div className="flex gap-2">
        <select
          value={cleaner}
          onChange={e => setCleaner(e.target.value)}
          className="flex-1 text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                     rounded-xl px-3 py-2.5 focus:outline-none appearance-none"
          style={dropdownStyle}
        >
          <option value="">Todo el personal</option>
          {staff.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
        <button
          onClick={shareWhatsApp}
          className="flex items-center gap-1.5 px-4 rounded-xl text-sm font-semibold text-white flex-shrink-0"
          style={{ background: '#25D366' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3M12 2a10 10 0 00-8.6 15l-1.3 4.7L7 20.4A10 10 0 1012 2z"/>
          </svg>
          Enviar
        </button>
      </div>

      {/* Days */}
      <div className="space-y-2">
        {days.map(d => {
          const isToday = d.iso === todayISO
          return (
            <div key={d.iso}
                 className={`bg-white rounded-xl border shadow-sm overflow-hidden
                             ${isToday ? 'border-[#6366f1]' : 'border-[#e2e8f0]'}`}>
              <div className={`flex items-center gap-2 px-3 py-2 border-b
                               ${isToday ? 'bg-[#eef2ff] border-[#e0e7ff]' : 'bg-[#f8fafc] border-[#f1f5f9]'}`}>
                <span className={`text-xs font-bold ${isToday ? 'text-[#6366f1]' : 'text-[#64748b]'}`}>
                  {d.label} {dayNum(d.iso)}
                </span>
                {isToday && <span className="text-[9px] font-bold text-[#6366f1] bg-white px-1.5 py-0.5 rounded-full">HOY</span>}
                {d.tasks.length > 0 && (
                  <span className="ml-auto text-[10px] text-[#94a3b8]">{d.tasks.length}</span>
                )}
              </div>
              {d.tasks.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[#cbd5e1]">—</p>
              ) : (
                <div className="divide-y divide-[#f1f5f9]">
                  {d.tasks.map(t => (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm">🧹</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#0f172a] truncate">{t.property_name}</p>
                        {t.assignee_name && !cleaner && (
                          <p className="text-[11px] text-[#94a3b8] truncate">{t.assignee_name}</p>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-[#6366f1] flex-shrink-0">{t.checkout_time}</span>
                      {t.status === 'done' && <span className="text-xs flex-shrink-0">✅</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
