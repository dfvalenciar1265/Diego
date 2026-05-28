'use client'
import { useState } from 'react'
import { Pagination, paginate, pageCount } from '@/components/ui/Pagination'
import type { Task, Property, TeamMember, MaintenanceIssue } from '@/lib/types'

type CleaningRow = Task & { property?: { name: string }; assignee?: { name: string } }
type MaintenanceRow = MaintenanceIssue & { property?: { name: string }; assignee?: { name: string } }
type OtherRow = Task & { property?: { name: string }; assignee?: { name: string } }

interface Props {
  cleaningTasks:     CleaningRow[]
  maintenanceIssues: MaintenanceRow[]
  otherTasks:        OtherRow[]
  properties:        Property[]
  teamMembers:       TeamMember[]
}

type Tab = 'cleaning' | 'expenses'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function fmtCOP(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toLocaleString('es-CO')}`
}

export function ReportsView({
  cleaningTasks,
  maintenanceIssues,
  otherTasks,
  properties,
  teamMembers,
}: Props) {
  const [tab,          setTab]          = useState<Tab>('cleaning')
  const [filterProp,   setFilterProp]   = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [cleanPage,    setCleanPage]    = useState(1)
  const [expPage,      setExpPage]      = useState(1)

  const PS = 5

  const dropdownStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundPosition: 'right 12px center',
  }

  // ── Cleaning report ────────────────────────────────────────────────────────
  const filteredCleaning = cleaningTasks.filter(t => {
    if (filterProp   && t.property_id !== filterProp) return false
    if (filterPerson && t.assigned_to !== filterPerson) return false
    return true
  })
  const pagedCleaning = paginate(filteredCleaning, cleanPage, PS)

  // ── Expense report ─────────────────────────────────────────────────────────
  type ExpenseRow = {
    date:     string | null
    property: string
    category: string
    detail:   string
    person:   string
    cost:     number
  }

  const expenseRows: ExpenseRow[] = [
    ...maintenanceIssues.map(i => ({
      date:     i.resolved_at ?? null,
      property: i.property?.name ?? '—',
      category: '🔧 Mantenimiento',
      detail:   i.title,
      person:   i.assignee?.name ?? '—',
      cost:     i.cost ?? 0,
    })),
    ...otherTasks.map(t => ({
      date:     t.completed_at ?? null,
      property: t.property?.name ?? '—',
      category: '📋 Tarea',
      detail:   t.notes ?? t.type,
      person:   t.assignee?.name ?? '—',
      cost:     t.cost ?? 0,
    })),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  const filteredExpenses = expenseRows.filter(r => {
    if (filterProp) {
      const propName = properties.find(p => p.id === filterProp)?.name
      if (propName && r.property !== propName) return false
    }
    return true
  })

  const totalExpenses = filteredExpenses.reduce((s, r) => s + r.cost, 0)
  const pagedExpenses = paginate(filteredExpenses, expPage, PS)

  return (
    <div className="p-4 space-y-4">

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={filterProp}
          onChange={e => { setFilterProp(e.target.value); setCleanPage(1); setExpPage(1) }}
          className="w-full text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                     rounded-xl px-3 py-2.5 focus:outline-none appearance-none"
          style={dropdownStyle}
        >
          <option value="">Todos los apts.</option>
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {tab === 'cleaning' && (
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
        )}

        {tab === 'expenses' && (
          <div className="flex items-center justify-center bg-[#f0fdf4] rounded-xl px-3 py-2.5 border border-[#bbf7d0]">
            <span className="text-xs font-semibold text-[#16a34a]">
              Total: {fmtCOP(totalExpenses)}
            </span>
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border border-[#e2e8f0]">
        <button
          onClick={() => { setTab('cleaning'); setCleanPage(1) }}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'cleaning' ? '#6366f1' : 'white',
            color:      tab === 'cleaning' ? 'white'   : '#64748b',
          }}
        >
          🧹 Limpiezas
        </button>
        <button
          onClick={() => { setTab('expenses'); setExpPage(1) }}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'expenses' ? '#6366f1' : 'white',
            color:      tab === 'expenses' ? 'white'   : '#64748b',
          }}
        >
          💰 Gastos
        </button>
      </div>

      {/* ── Cleaning report ────────────────────────────────────────────────── */}
      {tab === 'cleaning' && (
        <div>
          {filteredCleaning.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">🧹</p>
              <p className="text-[#94a3b8]">No hay limpiezas en los últimos 90 días</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shadow-sm">
              {/* Header */}
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

              {/* Footer totals (across all pages) */}
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
      )}

      {/* ── Expense report ─────────────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <div>
          {filteredExpenses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">💰</p>
              <p className="text-[#94a3b8]">No hay gastos registrados en los últimos 90 días</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shadow-sm">
              {/* Header */}
              <div className="grid grid-cols-[1fr_1fr_auto] bg-[#f8fafc] border-b border-[#e2e8f0]">
                <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide">Fecha / Categoría</div>
                <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide">Detalle / Apto.</div>
                <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide text-right">Costo</div>
              </div>

              {pagedExpenses.map((r, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[1fr_1fr_auto] border-b border-[#f1f5f9] last:border-0
                               ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}
                >
                  <div className="px-3 py-3">
                    <p className="text-xs font-semibold text-[#0f172a]">{fmtDate(r.date)}</p>
                    <p className="text-[11px] text-[#64748b]">{r.category}</p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-xs text-[#0f172a] truncate">{r.detail}</p>
                    <p className="text-[11px] text-[#94a3b8] truncate">{r.property}</p>
                  </div>
                  <div className="px-3 py-3 text-right">
                    <p className="text-xs font-semibold text-[#ef4444]">{fmtCOP(r.cost)}</p>
                  </div>
                </div>
              ))}

              {/* Footer totals (across all pages) */}
              <div className="grid grid-cols-[1fr_1fr_auto] bg-[#fff5f5] border-t border-[#fecaca]">
                <div className="px-3 py-2 col-span-2">
                  <span className="text-xs font-bold text-[#ef4444]">
                    Total ({filteredExpenses.length} ítems)
                  </span>
                </div>
                <div className="px-3 py-2 text-right">
                  <span className="text-xs font-bold text-[#ef4444]">
                    {fmtCOP(totalExpenses)}
                  </span>
                </div>
              </div>
            </div>
          )}
          <Pagination
            page={expPage}
            total={pageCount(filteredExpenses.length, PS)}
            onChange={setExpPage}
            accent="#6366f1"
          />
        </div>
      )}
    </div>
  )
}
