'use client'
import { useState } from 'react'
import { Pagination, paginate, pageCount } from '@/components/ui/Pagination'
import { IncomeReport } from './IncomeReport'
import { CleaningCostReport } from './CleaningCostReport'
import { ExpensesView } from './ExpensesView'
import type { Task, Property, TeamMember, Expense } from '@/lib/types'
import type { IncomeRow, CleaningCostRow } from '@/actions/reports'

type CleaningRow = Task & { property?: { name: string }; assignee?: { name: string } }

interface Props {
  cleaningTasks:     CleaningRow[]
  properties:        Property[]
  teamMembers:       TeamMember[]
  incomeRows:        IncomeRow[]
  cleaningCostRows:  CleaningCostRow[]
  currentYear:       number
  currentMonth:      number
  expenses:          Expense[]
}

type Tab = 'cleaning' | 'expenses' | 'income' | 'cleaning_costs'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function fmtCOP(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toLocaleString('es-CO')}`
}

export function ReportsView({
  cleaningTasks,
  properties,
  teamMembers,
  incomeRows,
  cleaningCostRows,
  currentYear,
  currentMonth,
  expenses,
}: Props) {
  const [tab,          setTab]          = useState<Tab>('income')
  const [filterProp,   setFilterProp]   = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [cleanPage,    setCleanPage]    = useState(1)

  const PS = 5

  const dropdownStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundPosition: 'right 12px center',
  }

  // ── Cleaning report ────────────────────────────────────────────────────────
  const filteredCleaning = cleaningTasks.filter(t => {
    if (filterProp   && t.property_id !== filterProp)   return false
    if (filterPerson && t.assigned_to !== filterPerson) return false
    return true
  })
  const pagedCleaning = paginate(filteredCleaning, cleanPage, PS)


  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs: { key: Tab; label: string }[] = [
    { key: 'income',         label: '💵 Ingresos'  },
    { key: 'cleaning_costs', label: '🧹 Costos'    },
    { key: 'cleaning',       label: '📋 Limpiezas' },
    { key: 'expenses',       label: '💰 Gastos'    },
  ]

  return (
    <div className="p-4 space-y-4">

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 rounded-xl overflow-hidden border border-[#e2e8f0]">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="py-2.5 text-[11px] font-medium transition-colors leading-tight"
            style={{
              background: tab === t.key ? '#6366f1' : 'white',
              color:      tab === t.key ? 'white'   : '#64748b',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Income report ─────────────────────────────────────────────────── */}
      {tab === 'income' && (
        <IncomeReport
          initialRows={incomeRows}
          initialYear={currentYear}
          initialMonth={currentMonth}
        />
      )}

      {/* ── Cleaning cost report ──────────────────────────────────────────── */}
      {tab === 'cleaning_costs' && (
        <CleaningCostReport
          initialRows={cleaningCostRows}
          initialYear={currentYear}
          initialMonth={currentMonth}
        />
      )}

      {/* ── Cleaning task history ─────────────────────────────────────────── */}
      {tab === 'cleaning' && (
        <>
          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filterProp}
              onChange={e => { setFilterProp(e.target.value); setCleanPage(1) }}
              className="w-full text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                         rounded-xl px-3 py-2.5 focus:outline-none appearance-none"
              style={dropdownStyle}
            >
              <option value="">Todos los apts.</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={filterPerson}
              onChange={e => { setFilterPerson(e.target.value); setCleanPage(1) }}
              className="w-full text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                         rounded-xl px-3 py-2.5 focus:outline-none appearance-none"
              style={dropdownStyle}
            >
              <option value="">Todo el personal</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            {filteredCleaning.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">🧹</p>
                <p className="text-[#94a3b8]">No hay limpiezas en los últimos 90 días</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shadow-sm">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-0 bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide">Fecha / Apto.</div>
                  <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide">Personal</div>
                  <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide text-right">Costo</div>
                </div>
                {pagedCleaning.map((t, i) => (
                  <div
                    key={t.id}
                    className={`grid grid-cols-[1fr_1fr_auto] gap-0 border-b border-[#f1f5f9] last:border-0
                                 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}
                  >
                    <div className="px-3 py-3">
                      <p className="text-xs font-semibold text-[#0f172a]">{fmtDate(t.completed_at)}</p>
                      <p className="text-[11px] text-[#64748b] truncate">{t.property?.name ?? '—'}</p>
                    </div>
                    <div className="px-3 py-3">
                      <p className="text-xs text-[#0f172a]">{t.assignee?.name ?? 'Sin asignar'}</p>
                    </div>
                    <div className="px-3 py-3 text-right">
                      <p className="text-xs font-semibold text-[#0f172a]">
                        {t.cost != null ? fmtCOP(t.cost) : '—'}
                      </p>
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-[1fr_1fr_auto] bg-[#f0fdf4] border-t border-[#bbf7d0]">
                  <div className="px-3 py-2 col-span-2">
                    <span className="text-xs font-bold text-[#16a34a]">
                      {filteredCleaning.length} limpiezas en total
                    </span>
                  </div>
                  <div className="px-3 py-2 text-right">
                    <span className="text-xs font-bold text-[#16a34a]">
                      {fmtCOP(filteredCleaning.reduce((s, t) => s + (t.cost ?? 0), 0))}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <Pagination
              page={cleanPage}
              total={pageCount(filteredCleaning.length, PS)}
              onChange={setCleanPage}
              accent="#6366f1"
            />
          </div>
        </>
      )}

      {/* ── Gastos (expenses table) ────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <ExpensesView expenses={expenses} properties={properties} />
      )}
    </div>
  )
}
