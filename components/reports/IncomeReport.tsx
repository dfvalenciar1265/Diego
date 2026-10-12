'use client'
import { Fragment, useState, useTransition } from 'react'
import { getIncomeReport, type IncomeRow } from '@/actions/reports'
import { MONTHS, fmtCOP, PeriodNav, ExportCsvButton, ReportTable, Money, type Column } from './shared'


interface Props {
  initialRows:  IncomeRow[]
  initialYear:  number
  initialMonth: number
}

export function IncomeReport({ initialRows, initialYear, initialMonth }: Props) {
  const [year,       setYear]       = useState(initialYear)
  const [month,      setMonth]      = useState(initialMonth)
  const [rows,       setRows]       = useState<IncomeRow[]>(initialRows)
  const [isPending,  startTransition] = useTransition()

  function navigate(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1)  { m = 12; y-- }
    if (m > 12) { m = 1;  y++ }

    // Don't go beyond current month
    const now = new Date()
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) return

    setYear(y)
    setMonth(m)
    startTransition(async () => {
      const data = await getIncomeReport(y, m)
      setRows(data)
    })
  }

  // Aggregate by property
  type PropSummary = { id: string; name: string; q1: number; q2: number; count: number }
  const byProp = new Map<string, PropSummary>()
  for (const r of rows) {
    if (!byProp.has(r.property_id)) {
      byProp.set(r.property_id, { id: r.property_id, name: r.property_name, q1: 0, q2: 0, count: 0 })
    }
    const e = byProp.get(r.property_id)!
    e.q1 += r.p1_amount
    e.q2 += r.p2_amount
    e.count++
  }
  const props    = [...byProp.values()].sort((a, b) => a.name.localeCompare(b.name))
  const totalQ1  = props.reduce((s, p) => s + p.q1, 0)
  const totalQ2  = props.reduce((s, p) => s + p.q2, 0)
  const grandTotal = totalQ1 + totalQ2
  const totalCount = props.reduce((s, p) => s + p.count, 0)

  const green = '#16a34a'
  const columns: Column<PropSummary>[] = [
    { header: 'Apartamento', cell: p => p.name },
    { header: 'Reservas',    numeric: true, cell: p => p.count, total: totalCount },
    { header: 'Q1 (1–15)',   numeric: true, cell: p => <Money value={p.q1} tone={green} />, total: <Money value={totalQ1} tone={green} /> },
    { header: 'Q2 (16–fin)', numeric: true, cell: p => <Money value={p.q2} tone={green} />, total: <Money value={totalQ2} tone={green} /> },
    { header: 'Total',       numeric: true, cell: p => <b><Money value={p.q1 + p.q2} tone={green} /></b>, total: <Money value={grandTotal} tone={green} /> },
  ]

  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="space-y-4">

      {/* ── Month navigator ──────────────────────────────────────────────── */}
      <PeriodNav
        title={`${MONTHS[month - 1]} ${year}`}
        subtitle="Reporte de ingresos"
        pending={isPending}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        nextDisabled={isCurrent}
      />

      <ExportCsvButton
        kind="ingresos" year={year} month={month} disabled={isPending}
        headers={columns.map(c => c.header)}
        rows={props.map(p => [p.name, p.count, p.q1, p.q2, p.q1 + p.q2])}
        totals={['Total', totalCount, totalQ1, totalQ2, grandTotal]}
      />

      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">💵</p>
          <p className="text-[#64748b]">Sin ingresos en {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (
        <>
          {/* ── Summary table ───────────────────────────────────────────────
                One single grid for header + every row + totals, so the columns
                are sized once and shared. A grid per row would size its own
                `auto` columns from its own content and nothing would line up. */}
          <ReportTable
            caption={`Ingresos por apartamento, ${MONTHS[month - 1]} ${year}`}
            columns={columns}
            rows={props}
            rowKey={p => p.id}
            totalLabel={`Total ${MONTHS[month - 1]}`}
            totalTone={{ text: green, bg: '#f0fdf4', border: '#bbf7d0' }}
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
                <Fragment key={p.id}>
                  <div className={`${cell} min-w-0`}>
                    <p className="text-xs font-semibold text-[#0f172a] truncate">{p.name}</p>
                    <p className="text-[11px] text-[#64748b]">
                      {p.count} reserva{p.count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className={`${cell} text-right`}>
                    <p className="text-xs font-semibold text-[#16a34a]">{p.q1 > 0 ? fmtCOP(p.q1) : '—'}</p>
                  </div>
                  <div className={`${cell} text-right`}>
                    <p className="text-xs font-semibold text-[#16a34a]">{p.q2 > 0 ? fmtCOP(p.q2) : '—'}</p>
                  </div>
                </Fragment>
              )
            })}

            {/* Totals */}
            <div className="px-3 py-2 bg-[#f0fdf4] border-t border-[#bbf7d0]">
              <span className="text-xs font-bold text-[#16a34a]">Total {MONTHS[month - 1]}</span>
            </div>
            <div className="px-3 py-2 text-right bg-[#f0fdf4] border-t border-[#bbf7d0]">
              <span className="text-xs font-bold text-[#16a34a]">{fmtCOP(totalQ1)}</span>
            </div>
            <div className="px-3 py-2 text-right bg-[#f0fdf4] border-t border-[#bbf7d0]">
              <span className="text-xs font-bold text-[#16a34a]">{fmtCOP(totalQ2)}</span>
            </div>
          </div>

          {/* Grand total */}
          <div className="bg-[#eff6ff] rounded-xl border border-[#bfdbfe] px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-[#1d4ed8]">Total del mes</span>
            <span className="text-base font-bold text-[#1d4ed8]">{fmtCOP(grandTotal)}</span>
          </div>
        </>
      )}
    </div>
  )
}
