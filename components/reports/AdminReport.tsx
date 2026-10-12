'use client'
import { Fragment, useState, useTransition } from 'react'
import { getIncomeReport, type IncomeRow } from '@/actions/reports'
import { MONTHS, fmtCOP, PeriodNav, ExportCsvButton, ReportTable, Money, type Column } from './shared'

/** Costo fijo de administración por quincena (COP). Cambiar aquí si sube. */
const ADMIN_PER_QUINCENA = 1_250_000

function fmtPct(f: number): string {
  return f.toLocaleString('es-CO', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

interface Props {
  initialRows:  IncomeRow[]
  initialYear:  number
  initialMonth: number
}

type PropRow = {
  id: string; name: string
  q1Income: number; q2Income: number
  q1Pct: number; q2Pct: number
  q1Admin: number; q2Admin: number
}

/**
 * Distributes `cost` across rows in proportion to each row's income for the
 * quincena. Rounds to whole pesos and hands the rounding remainder to the
 * biggest contributor, so the column adds up to `cost` exactly. Returns
 * zeros (and total 0) when the quincena has no income to prorate.
 */
function prorate(rows: { income: number }[], cost: number): { pct: number; admin: number }[] {
  const total = rows.reduce((s, r) => s + r.income, 0)
  if (total <= 0) return rows.map(() => ({ pct: 0, admin: 0 }))
  const out = rows.map(r => ({ pct: r.income / total, admin: Math.round((r.income / total) * cost) }))
  const residual = cost - out.reduce((s, x) => s + x.admin, 0)
  if (residual !== 0) {
    let maxIdx = 0
    for (let i = 1; i < rows.length; i++) if (rows[i].income > rows[maxIdx].income) maxIdx = i
    out[maxIdx].admin += residual
  }
  return out
}

export function AdminReport({ initialRows, initialYear, initialMonth }: Props) {
  const [year,  setYear]  = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [rows,  setRows]  = useState<IncomeRow[]>(initialRows)
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
    startTransition(async () => setRows(await getIncomeReport(y, m)))
  }

  // Income per apartment (Q1 = days 1–15, Q2 = 16–end), same source as Ingresos.
  const byProp = new Map<string, { id: string; name: string; q1Income: number; q2Income: number }>()
  for (const r of rows) {
    let e = byProp.get(r.property_id)
    if (!e) { e = { id: r.property_id, name: r.property_name, q1Income: 0, q2Income: 0 }; byProp.set(r.property_id, e) }
    e.q1Income += r.p1_amount
    e.q2Income += r.p2_amount
  }
  const base = [...byProp.values()].sort((a, b) => a.name.localeCompare(b.name))

  const q1 = prorate(base.map(p => ({ income: p.q1Income })), ADMIN_PER_QUINCENA)
  const q2 = prorate(base.map(p => ({ income: p.q2Income })), ADMIN_PER_QUINCENA)
  const props: PropRow[] = base.map((p, i) => ({
    ...p, q1Pct: q1[i].pct, q1Admin: q1[i].admin, q2Pct: q2[i].pct, q2Admin: q2[i].admin,
  }))

  const hasQ1 = base.some(p => p.q1Income > 0)
  const hasQ2 = base.some(p => p.q2Income > 0)
  const totalQ1 = hasQ1 ? ADMIN_PER_QUINCENA : 0
  const totalQ2 = hasQ2 ? ADMIN_PER_QUINCENA : 0
  const grandTotal = totalQ1 + totalQ2
  const incomeQ1   = base.reduce((s, p) => s + p.q1Income, 0)
  const incomeQ2   = base.reduce((s, p) => s + p.q2Income, 0)

  /** Percentage for the CSV, one decimal (12.5 → «12,5» in Excel). */
  const pct1 = (f: number) => Math.round(f * 1000) / 10
  const amber = '#b45309'
  const pctCell = (f: number, admin: number) => admin > 0 ? fmtPct(f) : <span className="text-[#64748b]">—</span>
  const columns: Column<PropRow>[] = [
    { header: 'Apartamento',  cell: p => p.name },
    { header: 'Ingreso Q1',   numeric: true, cell: p => <Money value={p.q1Income} />, total: <Money value={incomeQ1} /> },
    { header: '% Q1',         numeric: true, cell: p => pctCell(p.q1Pct, p.q1Admin) },
    { header: 'Admin Q1',     numeric: true, cell: p => <Money value={p.q1Admin} tone={amber} />, total: <Money value={totalQ1} tone={amber} /> },
    { header: 'Ingreso Q2',   numeric: true, cell: p => <Money value={p.q2Income} />, total: <Money value={incomeQ2} /> },
    { header: '% Q2',         numeric: true, cell: p => pctCell(p.q2Pct, p.q2Admin) },
    { header: 'Admin Q2',     numeric: true, cell: p => <Money value={p.q2Admin} tone={amber} />, total: <Money value={totalQ2} tone={amber} /> },
    { header: 'Total admin',  numeric: true, cell: p => <b><Money value={p.q1Admin + p.q2Admin} tone={amber} /></b>,
      total: <Money value={grandTotal} tone={amber} /> },
  ]

  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="space-y-4">

      {/* ── Month navigator ──────────────────────────────────────────────── */}
      <PeriodNav
        title={`${MONTHS[month - 1]} ${year}`}
        subtitle="Costo de administración"
        pending={isPending}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        nextDisabled={isCurrent}
      />

      <ExportCsvButton
        kind="administracion" year={year} month={month} disabled={isPending}
        headers={columns.map(c => c.header)}
        rows={props.map(p => [
          p.name, p.q1Income, pct1(p.q1Pct), p.q1Admin, p.q2Income, pct1(p.q2Pct), p.q2Admin, p.q1Admin + p.q2Admin,
        ])}
        totals={['Total', incomeQ1, '', totalQ1, incomeQ2, '', totalQ2, grandTotal]}
      />

      {/* ── Admin cost reference ─────────────────────────────────────────── */}
      <div className="bg-[#fffbeb] rounded-xl border border-[#fde68a] px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#b45309] uppercase tracking-wide">Costo administración</span>
        <span className="text-[11px] text-[#92400e]">
          <b>{fmtCOP(ADMIN_PER_QUINCENA)}</b> / quincena · <b>{fmtCOP(ADMIN_PER_QUINCENA * 2)}</b> / mes
        </span>
      </div>

      {props.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🏢</p>
          <p className="text-[#64748b]">Sin ingresos en {MONTHS[month - 1]} {year} para prorratear</p>
        </div>
      ) : (
        <>
          {/* ── Table (single grid so Q1/Q2 columns line up) ─────────────── */}
          <ReportTable
            caption={`Costo de administración por apartamento, ${MONTHS[month - 1]} ${year}`}
            columns={columns}
            rows={props}
            rowKey={p => p.id}
            totalLabel={`Total ${MONTHS[month - 1]}`}
            totalTone={{ text: amber, bg: '#fffbeb', border: '#fde68a' }}
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
                  </div>
                  <div className={`${cell} text-right`}>
                    {p.q1Admin > 0 ? (
                      <>
                        <p className="text-[11px] text-[#64748b]">{fmtPct(p.q1Pct)}</p>
                        <p className="text-xs font-semibold text-[#d97706]">{fmtCOP(p.q1Admin)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-[#cbd5e1]">—</p>
                    )}
                  </div>
                  <div className={`${cell} text-right`}>
                    {p.q2Admin > 0 ? (
                      <>
                        <p className="text-[11px] text-[#64748b]">{fmtPct(p.q2Pct)}</p>
                        <p className="text-xs font-semibold text-[#d97706]">{fmtCOP(p.q2Admin)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-[#cbd5e1]">—</p>
                    )}
                  </div>
                </Fragment>
              )
            })}

            {/* Totals */}
            <div className="px-3 py-2 bg-[#fffbeb] border-t border-[#fde68a]">
              <span className="text-xs font-bold text-[#b45309]">Total {MONTHS[month - 1]}</span>
            </div>
            <div className="px-3 py-2 text-right bg-[#fffbeb] border-t border-[#fde68a]">
              <span className="text-xs font-bold text-[#b45309]">{totalQ1 > 0 ? fmtCOP(totalQ1) : '—'}</span>
            </div>
            <div className="px-3 py-2 text-right bg-[#fffbeb] border-t border-[#fde68a]">
              <span className="text-xs font-bold text-[#b45309]">{totalQ2 > 0 ? fmtCOP(totalQ2) : '—'}</span>
            </div>
          </div>

          {/* Grand total */}
          <div className="bg-[#fffbeb] rounded-xl border border-[#fde68a] px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-[#b45309]">Total del mes</span>
            <span className="text-base font-bold text-[#b45309]">{fmtCOP(grandTotal)}</span>
          </div>
        </>
      )}
    </div>
  )
}
