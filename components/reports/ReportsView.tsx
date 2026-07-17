'use client'
import { useState } from 'react'
import { IncomeReport } from './IncomeReport'
import { CleaningCostReport } from './CleaningCostReport'
import { EmployeeCleaningReport } from './EmployeeCleaningReport'
import { ExpensesView } from './ExpensesView'
import { ProfitabilityReport } from './ProfitabilityReport'
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

type Tab = 'profitability' | 'expenses' | 'income' | 'cleaning_costs' | 'employee'

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
  const [tab, setTab] = useState<Tab>('profitability')

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs: { key: Tab; label: string }[] = [
    { key: 'profitability',  label: '📈 Renta'    },
    { key: 'income',         label: '💵 Ingresos' },
    { key: 'cleaning_costs', label: '🧹 Costos'   },
    { key: 'employee',       label: '👤 Empleada' },
    { key: 'expenses',       label: '💰 Gastos'   },
  ]

  return (
    <div className="p-4 space-y-4">

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 rounded-xl overflow-hidden border border-[#e2e8f0]">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="py-2.5 text-[10px] font-medium transition-colors leading-tight"
            style={{
              background: tab === t.key ? '#6366f1' : 'white',
              color:      tab === t.key ? 'white'   : '#64748b',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

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

      {/* ── Gastos (expenses table) ────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <ExpensesView expenses={expenses} properties={properties} />
      )}
    </div>
  )
}
