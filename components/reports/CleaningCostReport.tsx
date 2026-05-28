'use client'
import { useState, useTransition } from 'react'
import { getCleaningCostReport, type CleaningCostRow } from '@/actions/reports'
import { CLEANING_PRICES } from '@/lib/cleaning-prices'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmtCOP(n: number): string {
  return `$${n.toLocaleString('es-CO')}`
}

interface Props {
  initialRows:  CleaningCostRow[]
  initialYear:  number
  initialMonth: number
}

type PeriodEntry = { count: number; cost: number }
type PropSummary = { name: string; q1: PeriodEntry; q2: PeriodEntry; fixedPrice: number }

export function CleaningCostReport({ initialRows, initialYear, initialMonth }: Props) {
  const [year,      setYear]       = useState(initialYear)
  const [month,     setMonth]      = useState(initialMonth)
  const [rows,      setRows]       = useState<CleaningCostRow[]>(initialRows)
  const [isPending, startTransition] = useTransition()

  function navigate(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1)  { m = 12; y-- }
    if (m > 12) { m = 1;  y++ }

    const now = new Date()
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) return

    setYear(y)
    setMonth(m)
    startTransition(async () => {
      const data = await getCleaningCostReport(y, m)
      setRows(data)
    })
  }

  // Build per-property summary, starting with all known properties (even if 0 cleanings)
  const summaryMap = new Map<string, PropSummary>(
    Object.entries(CLEANING_PRICES).map(([name, price]) => [
      name,
      { name, q1: { count: 0, cost: 0 }, q2: { count: 0, cost: 0 }, fixedPrice: price },
    ])
  )

  for (const r of rows) {
    if (!summaryMap.has(r.property_name)) {
      // Unknown property (not in fixed list) — add dynamically
      summaryMap.set(r.property_name, {
        name: r.property_name,
        q1: { count: 0, cost: 0 },
        q2: { count: 0, cost: 0 },
        fixedPrice: r.fixed_price,
      })
    }
    const e = summaryMap.get(r.property_name)!
    if (r.period === 1) { e.q1.count++; e.q1.cost += r.actual_cost }
    else                { e.q2.count++; e.q2.cost += r.actual_cost }
  }

  // Only show properties that had at least one cleaning in the month
  const props    = [...summaryMap.values()]
    .filter(p => p.q1.count + p.q2.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  const totalQ1    = props.reduce((s, p) => s + p.q1.cost, 0)
  const totalQ2    = props.reduce((s, p) => s + p.q2.cost, 0)
  const grandTotal = totalQ1 + totalQ2

  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="space-y-4">

      {/* ── Month navigator ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-[#e2e8f0] px-4 py-3 shadow-sm">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#0ea5e9] font-bold text-xl active:opacity-60"
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold text-[#0f172a] capitalize">
            {isPending ? '…' : `${MONTHS[month - 1]} ${year}`}
          </p>
          <p className="text-[10px] text-[#94a3b8] uppercase tracking-wide">Costos de limpieza</p>
        </div>
        <button
          onClick={() => navigate(1)}
          disabled={isCurrent}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#0ea5e9] font-bold text-xl active:opacity-60 disabled:text-[#cbd5e1]"
        >›</button>
      </div>

      {/* ── Fixed prices reference ───────────────────────────────────────── */}
      <div className="bg-[#f0f9ff] rounded-xl border border-[#bae6fd] px-3 py-2.5">
        <p className="text-[10px] font-bold text-[#0369a1] uppercase tracking-wide mb-2">Tarifa por limpieza</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(CLEANING_PRICES).map(([name, price]) => (
            <div key={name} className="flex justify-between items-center">
              <span className="text-[10px] text-[#334155] truncate mr-1">{name}</span>
              <span className="text-[10px] font-semibold text-[#0369a1] shrink-0">{fmtCOP(price)}</span>
            </div>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🧹</p>
          <p className="text-[#94a3b8]">Sin limpiezas en {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (
        <>
          {/* ── Summary table ───────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shadow-sm">
            <div className="grid grid-cols-[1fr_auto_auto] bg-[#f8fafc] border-b border-[#e2e8f0]">
              <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide">Apartamento</div>
              <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide text-right">Q1 (1–15)</div>
              <div className="px-3 py-2 text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide text-right">Q2 (16–fin)</div>
            </div>

            {props.map((p, i) => (
              <div
                key={p.name}
                className={`grid grid-cols-[1fr_auto_auto] border-b border-[#f1f5f9] last:border-0
                            ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}
              >
                <div className="px-3 py-3">
                  <p className="text-xs font-semibold text-[#0f172a] truncate">{p.name}</p>
                  <p className="text-[11px] text-[#94a3b8]">
                    {fmtCOP(p.fixedPrice)} / limpieza
                  </p>
                </div>
                <div className="px-3 py-3 text-right">
                  {p.q1.count > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-[#ef4444]">{fmtCOP(p.q1.cost)}</p>
                      <p className="text-[10px] text-[#94a3b8]">{p.q1.count}×</p>
                    </>
                  ) : (
                    <p className="text-xs text-[#cbd5e1]">—</p>
                  )}
                </div>
                <div className="px-3 py-3 text-right">
                  {p.q2.count > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-[#ef4444]">{fmtCOP(p.q2.cost)}</p>
                      <p className="text-[10px] text-[#94a3b8]">{p.q2.count}×</p>
                    </>
                  ) : (
                    <p className="text-xs text-[#cbd5e1]">—</p>
                  )}
                </div>
              </div>
            ))}

            {/* Totals row */}
            <div className="grid grid-cols-[1fr_auto_auto] bg-[#fff5f5] border-t border-[#fecaca]">
              <div className="px-3 py-2">
                <span className="text-xs font-bold text-[#ef4444]">Total {MONTHS[month - 1]}</span>
              </div>
              <div className="px-3 py-2 text-right">
                <span className="text-xs font-bold text-[#ef4444]">{fmtCOP(totalQ1)}</span>
              </div>
              <div className="px-3 py-2 text-right">
                <span className="text-xs font-bold text-[#ef4444]">{fmtCOP(totalQ2)}</span>
              </div>
            </div>
          </div>

          {/* Grand total */}
          <div className="bg-[#fff5f5] rounded-xl border border-[#fecaca] px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-[#ef4444]">Total del mes</span>
            <span className="text-base font-bold text-[#ef4444]">{fmtCOP(grandTotal)}</span>
          </div>
        </>
      )}
    </div>
  )
}
