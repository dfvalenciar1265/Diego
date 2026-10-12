'use client'
import { Fragment, useState, useTransition } from 'react'
import { getCleaningCostReport, type CleaningCostRow } from '@/actions/reports'
import { CLEANING_PRICES } from '@/lib/cleaning-prices'
import { MONTHS, fmtCOP, PeriodNav, ExportCsvButton, ReportTable, Money, type Column } from './shared'

interface Props {
  initialRows:  CleaningCostRow[]
  initialYear:  number
  initialMonth: number
}

type PeriodEntry = { count: number; cost: number }
type PropSummary = { name: string; q1: PeriodEntry; q2: PeriodEntry; fixedPrice: number }

/**
 * "3 × $45.000" — the calculation behind the period's cost. Falls back to a plain
 * count when a task carries a manual cost, since then the total is not
 * count × fixed price and showing the multiplication would be a lie.
 */
function calcLabel(e: PeriodEntry, fixedPrice: number): string {
  return e.cost === e.count * fixedPrice
    ? `${e.count} × ${fmtCOP(fixedPrice)}`
    : `${e.count} limpieza${e.count !== 1 ? 's' : ''}`
}

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
  const countQ1    = props.reduce((s, p) => s + p.q1.count, 0)
  const countQ2    = props.reduce((s, p) => s + p.q2.count, 0)

  const red = '#ef4444'
  const columns: Column<PropSummary>[] = [
    { header: 'Apartamento',  cell: p => p.name },
    { header: 'Tarifa',       numeric: true, cell: p => fmtCOP(p.fixedPrice) },
    { header: 'Limpiezas Q1', numeric: true, cell: p => p.q1.count || '—', total: countQ1 },
    { header: 'Costo Q1',     numeric: true, cell: p => <Money value={p.q1.cost} tone={red} />, total: <Money value={totalQ1} tone={red} /> },
    { header: 'Limpiezas Q2', numeric: true, cell: p => p.q2.count || '—', total: countQ2 },
    { header: 'Costo Q2',     numeric: true, cell: p => <Money value={p.q2.cost} tone={red} />, total: <Money value={totalQ2} tone={red} /> },
    { header: 'Total',        numeric: true, cell: p => <b><Money value={p.q1.cost + p.q2.cost} tone={red} /></b>,
      total: <Money value={grandTotal} tone={red} /> },
  ]

  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="space-y-4">

      {/* ── Month navigator ──────────────────────────────────────────────── */}
      <PeriodNav
        title={`${MONTHS[month - 1]} ${year}`}
        subtitle="Costos de limpieza"
        pending={isPending}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        nextDisabled={isCurrent}
        accent="#0ea5e9"
      />

      <ExportCsvButton
        kind="costos-limpieza" year={year} month={month} disabled={isPending}
        headers={columns.map(c => c.header)}
        rows={props.map(p => [
          p.name, p.fixedPrice, p.q1.count, p.q1.cost, p.q2.count, p.q2.cost, p.q1.cost + p.q2.cost,
        ])}
        totals={['Total', '', countQ1, totalQ1, countQ2, totalQ2, grandTotal]}
      />

      {/* ── Fixed prices reference ───────────────────────────────────────── */}
      <div className="bg-[#f0f9ff] rounded-xl border border-[#bae6fd] px-3 py-2.5">
        <p className="text-[11px] font-bold text-[#0369a1] uppercase tracking-wide mb-2">Tarifa por limpieza</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1">
          {Object.entries(CLEANING_PRICES).map(([name, price]) => (
            <div key={name} className="flex justify-between items-center">
              <span className="text-[11px] text-[#334155] truncate mr-1">{name}</span>
              <span className="text-[11px] font-semibold text-[#0369a1] shrink-0">{fmtCOP(price)}</span>
            </div>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🧹</p>
          <p className="text-[#64748b]">Sin limpiezas en {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (
        <>
          {/* ── Summary table ───────────────────────────────────────────────
                One single grid for header + every row + totals. A grid per row
                would size its own `auto` columns from its own content, so the
                Q1/Q2 figures would land at a different x on each row instead of
                lining up under their header. ─────────────────────────────── */}
          <ReportTable
            caption={`Costos de limpieza por apartamento, ${MONTHS[month - 1]} ${year}`}
            columns={columns}
            rows={props}
            rowKey={p => p.name}
            totalLabel={`Total ${MONTHS[month - 1]}`}
            totalTone={{ text: red, bg: '#fff5f5', border: '#fecaca' }}
          />

          {/* Mobile only — the desktop table above replaces it from md up */}
          <div className="md:hidden grid grid-cols-[1fr_auto_auto] bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-3 py-2 text-[11px] font-bold text-[#64748b] uppercase tracking-wide bg-[#f8fafc] border-b border-[#e2e8f0]">Apartamento</div>
            <div className="px-3 py-2 text-[11px] font-bold text-[#64748b] uppercase tracking-wide text-right bg-[#f8fafc] border-b border-[#e2e8f0]">Q1 (1–15)</div>
            <div className="px-3 py-2 text-[11px] font-bold text-[#64748b] uppercase tracking-wide text-right bg-[#f8fafc] border-b border-[#e2e8f0]">Q2 (16–fin)</div>

            {props.map((p, i) => {
              const cell = `px-3 py-3 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`
                         + (i < props.length - 1 ? ' border-b border-[#f1f5f9]' : '')
              return (
                <Fragment key={p.name}>
                  <div className={`${cell} min-w-0`}>
                    <p className="text-xs font-semibold text-[#0f172a] truncate">{p.name}</p>
                    <p className="text-[11px] text-[#64748b]">
                      {fmtCOP(p.fixedPrice)} / limpieza
                    </p>
                  </div>
                  <div className={`${cell} text-right`}>
                    {p.q1.count > 0 ? (
                      <>
                        <p className="text-[11px] text-[#64748b] whitespace-nowrap">{calcLabel(p.q1, p.fixedPrice)}</p>
                        <p className="text-xs font-semibold text-[#ef4444]">{fmtCOP(p.q1.cost)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-[#cbd5e1]">—</p>
                    )}
                  </div>
                  <div className={`${cell} text-right`}>
                    {p.q2.count > 0 ? (
                      <>
                        <p className="text-[11px] text-[#64748b] whitespace-nowrap">{calcLabel(p.q2, p.fixedPrice)}</p>
                        <p className="text-xs font-semibold text-[#ef4444]">{fmtCOP(p.q2.cost)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-[#cbd5e1]">—</p>
                    )}
                  </div>
                </Fragment>
              )
            })}

            {/* Totals */}
            <div className="px-3 py-2 bg-[#fff5f5] border-t border-[#fecaca]">
              <span className="text-xs font-bold text-[#ef4444]">Total {MONTHS[month - 1]}</span>
            </div>
            <div className="px-3 py-2 text-right bg-[#fff5f5] border-t border-[#fecaca]">
              <span className="text-xs font-bold text-[#ef4444]">{fmtCOP(totalQ1)}</span>
            </div>
            <div className="px-3 py-2 text-right bg-[#fff5f5] border-t border-[#fecaca]">
              <span className="text-xs font-bold text-[#ef4444]">{fmtCOP(totalQ2)}</span>
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
