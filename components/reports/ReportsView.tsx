'use client'
import { useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { IncomeReport } from './IncomeReport'
import { CleaningCostReport } from './CleaningCostReport'
import { EmployeeCleaningReport } from './EmployeeCleaningReport'
import { AdminReport } from './AdminReport'
import { ExpensesView } from './ExpensesView'
import { ProfitabilityReport } from './ProfitabilityReport'
import { REPORT_TABS, parseReportTab, type ReportTab as Tab } from './tabs'
import type { Property, Expense } from '@/lib/types'
import type { IncomeRow, CleaningCostRow, ProfitabilityRow, EmployeeCleaningRow } from '@/actions/reports'

interface Props {
  properties:            Property[]
  incomeRows:            IncomeRow[]
  cleaningCostRows:      CleaningCostRow[]
  profitabilityRows:     ProfitabilityRow[]
  employeeCleaningRows:  EmployeeCleaningRow[]
  currentYear:           number
  currentMonth:          number
  expenses:              Expense[]
}


export function ReportsView({
  properties,
  incomeRows,
  cleaningCostRows,
  profitabilityRows,
  employeeCleaningRows,
  currentYear,
  currentMonth,
  expenses,
}: Props) {
  // The active tab lives in the URL (?tab=income) so it survives a reload, the back
  // button and can be shared. history.replaceState updates useSearchParams without a
  // server round-trip (router.replace would re-run every report query on the page).
  const searchParams = useSearchParams()
  const tab = parseReportTab(searchParams.get('tab'))
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function selectTab(key: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (key === 'profitability') params.delete('tab')
    else params.set('tab', key)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  // ←/→/Inicio/Fin move between tabs (WAI-ARIA tabs pattern, automatic activation).
  function onTabKeyDown(e: React.KeyboardEvent, i: number) {
    const last = REPORT_TABS.length - 1
    const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
               : e.key === 'ArrowLeft'  ? (i === 0 ? last : i - 1)
               : e.key === 'Home'       ? 0
               : e.key === 'End'        ? last
               : null
    if (next === null) return
    e.preventDefault()
    selectTab(REPORT_TABS[next].key)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="p-4 space-y-4 md:max-w-6xl">

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Reportes"
        className="grid grid-cols-3 md:grid-cols-6 rounded-xl overflow-hidden border border-[#e2e8f0]"
      >
        {REPORT_TABS.map((t, i) => {
          const selected = tab === t.key
          return (
            <button
              key={t.key}
              ref={el => { tabRefs.current[i] = el }}
              type="button"
              role="tab"
              id={`reports-tab-${t.key}`}
              aria-selected={selected}
              aria-controls="reports-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(t.key)}
              onKeyDown={e => onTabKeyDown(e, i)}
              className="min-h-11 px-1 py-2 text-xs md:text-sm font-medium transition-colors leading-tight
                         focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0f172a]"
              style={{
                background: selected ? '#6366f1' : 'white',
                color:      selected ? 'white'   : '#64748b',
              }}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="reports-panel" aria-labelledby={`reports-tab-${tab}`} className="space-y-4">

        {/* ── Profitability (P&L per property) ──────────────────────────────── */}
        {tab === 'profitability' && (
          <ProfitabilityReport
            initialRows={profitabilityRows}
            initialYear={currentYear}
            initialMonth={currentMonth}
          />
        )}

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

        {/* ── Cleaning by employee (payroll per fortnight) ──────────────────── */}
        {tab === 'employee' && (
          <EmployeeCleaningReport
            initialRows={employeeCleaningRows}
            initialYear={currentYear}
            initialMonth={currentMonth}
          />
        )}

        {/* ── Administration cost (prorated by income share) ────────────────── */}
        {tab === 'admin' && (
          <AdminReport
            initialRows={incomeRows}
            initialYear={currentYear}
            initialMonth={currentMonth}
          />
        )}

        {/* ── Gastos (expenses table) ────────────────────────────────────────── */}
        {tab === 'expenses' && (
          <ExpensesView expenses={expenses} properties={properties} year={currentYear} month={currentMonth} />
        )}
      </div>
    </div>
  )
}
