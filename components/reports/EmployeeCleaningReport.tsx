'use client'
import { useState, useTransition } from 'react'
import { getCleaningByEmployee, type EmployeeCleaningRow } from '@/actions/reports'
import { CLEANING_PRICES } from '@/lib/cleaning-prices'
import { MONTHS, fmtCOP, PeriodNav, ExportCsvButton, ReportTable, Money, type Column } from './shared'

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

interface Props {
  initialRows:  EmployeeCleaningRow[]
  initialYear:  number
  initialMonth: number
}

type AptEntry   = { name: string; count: number; value: number }
type EmpSummary = { key: string; name: string; count: number; days: number; total: number; apts: AptEntry[] }

/** «Palmetto 1001 ×2 ($90.000) · Tocahagua 708 ×1 ($35.000)» */
function aptDetail(e: EmpSummary): string {
  return e.apts.map(a => `${a.name} ×${a.count} (${fmtCOP(a.value)})`).join(' · ')
}

export function EmployeeCleaningReport({ initialRows, initialYear, initialMonth }: Props) {
  const today = new Date()
  const [year,   setYear]   = useState(initialYear)
  const [month,  setMonth]  = useState(initialMonth)
  const [period, setPeriod] = useState<1 | 2>(today.getDate() <= 15 ? 1 : 2)
  const [rows,   setRows]   = useState<EmployeeCleaningRow[]>(initialRows)
  const [loadedMonth, setLoadedMonth] = useState(`${initialYear}-${initialMonth}`)
  const [isPending, startTransition]  = useTransition()

  // Is quincena (y,m,p) strictly after the current one? (used to block the future)
  function isFuture(y: number, m: number, p: 1 | 2): boolean {
    const cy = today.getFullYear(), cm = today.getMonth() + 1
    const cp: 1 | 2 = today.getDate() <= 15 ? 1 : 2
    if (y !== cy) return y > cy
    if (m !== cm) return m > cm
    return p > cp
  }

  // Step one quincena forward (+1) or back (−1), rolling months/years.
  function step(y: number, m: number, p: 1 | 2, delta: number) {
    if (delta > 0) { if (p === 1) return { y, m, p: 2 as const }
                     m++; if (m > 12) { m = 1; y++ }; return { y, m, p: 1 as const } }
    if (p === 2) return { y, m, p: 1 as const }
    m--; if (m < 1) { m = 12; y-- }; return { y, m, p: 2 as const }
  }

  const next      = step(year, month, period, 1)
  const canGoNext = !isFuture(next.y, next.m, next.p)

  function go(delta: number) {
    const t = step(year, month, period, delta)
    if (delta > 0 && isFuture(t.y, t.m, t.p)) return

    setYear(t.y); setMonth(t.m); setPeriod(t.p)

    const key = `${t.y}-${t.m}`
    if (key !== loadedMonth) {
      startTransition(async () => {
        const data = await getCleaningByEmployee(t.y, t.m)
        setRows(data)
        setLoadedMonth(key)
      })
    }
  }

  // Period metadata: Q1 is always 15 days; Q2 length varies with the month.
  const lastDay     = lastDayOfMonth(year, month)
  const periodDays  = period === 1 ? 15 : lastDay - 15
  const periodRange = period === 1 ? '1–15' : `16–${lastDay}`

  // Aggregate the selected quincena by employee.
  const empMap = new Map<string, EmpSummary & { _days: Set<number>; _apts: Map<string, AptEntry> }>()
  for (const r of rows) {
    if (r.period !== period) continue
    const key = r.employee_id ?? 'unassigned'
    let e = empMap.get(key)
    if (!e) {
      e = { key, name: r.employee_name, count: 0, days: 0, total: 0, apts: [], _days: new Set(), _apts: new Map() }
      empMap.set(key, e)
    }
    e.count++
    e.total += r.value
    e._days.add(r.day)
    const a = e._apts.get(r.property_name) ?? { name: r.property_name, count: 0, value: 0 }
    a.count++; a.value += r.value
    e._apts.set(r.property_name, a)
  }

  const employees: EmpSummary[] = [...empMap.values()]
    .map(e => ({
      key: e.key, name: e.name, count: e.count, days: e._days.size, total: e.total,
      apts: [...e._apts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.total - a.total)

  const grandTotal = employees.reduce((s, e) => s + e.total, 0)
  const totalCount = employees.reduce((s, e) => s + e.count, 0)

  const columns: Column<EmpSummary>[] = [
    { header: 'Empleada',      cell: e => e.name },
    { header: 'Aseos',         numeric: true, cell: e => e.count, total: totalCount },
    { header: 'Días laborados', numeric: true, cell: e => e.days },
    { header: 'Detalle por apartamento', cell: e => <span className="text-xs text-[#334155]">{aptDetail(e)}</span> },
    { header: 'Total a pagar', numeric: true, cell: e => <b><Money value={e.total} tone="#16a34a" /></b>,
      total: <Money value={grandTotal} tone="#16a34a" /> },
  ]

  return (
    <div className="space-y-4">

      {/* ── Quincena navigator ────────────────────────────────────────────── */}
      <PeriodNav
        title={`Q${period} · ${MONTHS[month - 1]} ${year}`}
        subtitle={`${periodDays} días (${periodRange})`}
        pending={isPending}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        nextDisabled={!canGoNext}
        prevLabel="Quincena anterior"
        nextLabel="Quincena siguiente"
      />

      <ExportCsvButton
        kind={`empleadas-q${period}`} year={year} month={month} disabled={isPending}
        headers={columns.map(c => c.header)}
        rows={employees.map(e => [e.name, e.count, e.days, aptDetail(e), e.total])}
        totals={['Total', totalCount, '', '', grandTotal]}
      />

      {employees.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🧹</p>
          <p className="text-[#64748b]">Sin aseos en Q{period} {MONTHS[month - 1]}</p>
        </div>
      ) : (
        <>
          <ReportTable
            caption={`Aseos por empleada, quincena ${period} de ${MONTHS[month - 1]} ${year}`}
            columns={columns}
            rows={employees}
            rowKey={e => e.key}
            totalLabel="Total quincena"
            totalTone={{ text: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' }}
          />

          {/* Mobile only — one card per employee */}
          {employees.map(e => (
            <div key={e.key} className="md:hidden bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shadow-sm">
              {/* Employee header: name · count · total to pay */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0]">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0f172a] truncate">{e.name}</p>
                  <p className="text-[11px] text-[#64748b]">
                    {e.count} {e.count === 1 ? 'aseo' : 'aseos'}
                  </p>
                </div>
                <span className="text-base font-bold text-[#16a34a] shrink-0 ml-2">{fmtCOP(e.total)}</span>
              </div>
              {/* Per-apartment breakdown */}
              <div className="divide-y divide-[#f1f5f9]">
                {e.apts.map(a => (
                  <div key={a.name} className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-[#334155] truncate mr-2">
                      {a.name} <span className="text-[#64748b]">×{a.count}</span>
                    </span>
                    <span className="text-xs font-semibold text-[#0f172a] shrink-0">{fmtCOP(a.value)}</span>
                  </div>
                ))}
              </div>
              {/* Days worked — its own item, separate from the money breakdown */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] border-t border-[#e2e8f0]">
                <span className="text-xs font-medium text-[#64748b]">📅 Días laborados en la quincena</span>
                <span className="text-xs font-bold text-[#0f172a] shrink-0 ml-2">
                  {e.days} {e.days === 1 ? 'día' : 'días'}
                </span>
              </div>
            </div>
          ))}

          {/* Grand total for the quincena */}
          <div className="bg-[#f0fdf4] rounded-xl border border-[#bbf7d0] px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-[#16a34a]">Total quincena</span>
            <span className="text-base font-bold text-[#16a34a]">{fmtCOP(grandTotal)}</span>
          </div>
        </>
      )}

      {/* ── Value per apartment reference ─────────────────────────────────── */}
      <div className="bg-[#f0f9ff] rounded-xl border border-[#bae6fd] px-3 py-2.5">
        <p className="text-[11px] font-bold text-[#0369a1] uppercase tracking-wide mb-2">Valor por limpieza</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1">
          {Object.entries(CLEANING_PRICES).map(([name, price]) => (
            <div key={name} className="flex justify-between items-center">
              <span className="text-[11px] text-[#334155] truncate mr-1">{name}</span>
              <span className="text-[11px] font-semibold text-[#0369a1] shrink-0">{fmtCOP(price)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
