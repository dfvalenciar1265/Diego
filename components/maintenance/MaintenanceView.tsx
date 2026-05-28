'use client'
import { useState } from 'react'
import { IncidenceCard } from './IncidenceCard'
import { ScheduledCard } from './ScheduledCard'
import type { MaintenanceIssue, Property, TeamMember } from '@/lib/types'

type IssueWithJoins = MaintenanceIssue & {
  property?: { name: string }
  reporter?: { name: string }
  assignee?: { name: string }
}

interface Props {
  issues:      IssueWithJoins[]
  properties:  Property[]
  teamMembers: TeamMember[]
}

type Tab = 'open' | 'resolved'

export function MaintenanceView({ issues, properties, teamMembers }: Props) {
  const [tab,        setTab]        = useState<Tab>('open')
  const [filterProp, setFilterProp] = useState('')

  const filtered = issues.filter(i => {
    if (filterProp && i.property_id !== filterProp) return false
    return true
  })

  // Scheduled (programmed) — separate from incidences
  const scheduled = filtered
    .filter(i => i.priority === 'scheduled' && i.status !== 'resolved')
    .sort((a, b) => {
      const getNext = (desc: string) => desc.match(/next:([^|]+)/)?.[1] ?? '9999'
      return getNext(a.description).localeCompare(getNext(b.description))
    })

  // Incidences (non-scheduled)
  const incidences = filtered.filter(i => i.priority !== 'scheduled')
  const open       = incidences.filter(i => i.status !== 'resolved')
  const resolved   = incidences.filter(i => i.status === 'resolved')

  const dropdownStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundPosition: 'right 12px center',
  }

  return (
    <div className="p-4 space-y-4">

      {/* ── Filtro de apartamento ─────────────────────────────────────────── */}
      <select
        value={filterProp}
        onChange={e => setFilterProp(e.target.value)}
        className="w-full text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                   rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1
                   focus:ring-[#ef4444] appearance-none"
        style={dropdownStyle}
      >
        <option value="">Todos los apartamentos</option>
        {properties.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border border-[#e2e8f0]">
        <button
          onClick={() => setTab('open')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'open' ? '#ef4444' : 'white',
            color:      tab === 'open' ? 'white'   : '#64748b',
          }}
        >
          Pendientes
          {(scheduled.length + open.length) > 0 && (
            <span
              className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{
                background: tab === 'open' ? 'rgba(255,255,255,0.25)' : '#fee2e2',
                color:      tab === 'open' ? 'white' : '#ef4444',
              }}
            >
              {scheduled.length + open.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('resolved')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'resolved' ? '#ef4444' : 'white',
            color:      tab === 'resolved' ? 'white'   : '#64748b',
          }}
        >
          Resueltas
          {resolved.length > 0 && (
            <span
              className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{
                background: tab === 'resolved' ? 'rgba(255,255,255,0.25)' : '#dcfce7',
                color:      tab === 'resolved' ? 'white' : '#16a34a',
              }}
            >
              {resolved.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Pendientes tab ────────────────────────────────────────────────── */}
      {tab === 'open' && (
        <div className="space-y-5">
          {scheduled.length === 0 && open.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">🔧</p>
              <p className="text-[#94a3b8]">Sin incidencias activas</p>
            </div>
          ) : (
            <>
              {/* Scheduled */}
              {scheduled.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🗓️</span>
                    <span className="text-xs font-semibold text-[#6366f1] uppercase tracking-wide">
                      Programados ({scheduled.length})
                    </span>
                    <div className="flex-1 h-px bg-[#e0e7ff]" />
                  </div>
                  <div className="space-y-3">
                    {scheduled.map(i => <ScheduledCard key={i.id} issue={i} />)}
                  </div>
                </section>
              )}

              {/* Open incidences */}
              {open.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🔧</span>
                    <span className="text-xs font-semibold text-[#ef4444] uppercase tracking-wide">
                      Incidencias abiertas ({open.length})
                    </span>
                    <div className="flex-1 h-px bg-[#fee2e2]" />
                  </div>
                  <div className="space-y-3">
                    {open.map(i => (
                      <IncidenceCard key={i.id} issue={i} teamMembers={teamMembers} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Resueltas tab ─────────────────────────────────────────────────── */}
      {tab === 'resolved' && (
        <div className="space-y-3">
          {resolved.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-[#94a3b8]">No hay incidencias resueltas</p>
            </div>
          ) : (
            resolved.map(i => (
              <IncidenceCard key={i.id} issue={i} teamMembers={teamMembers} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
