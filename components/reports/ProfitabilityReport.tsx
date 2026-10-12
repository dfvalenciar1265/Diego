'use client'
import { useState, useTransition } from 'react'
import { getProfitabilityReport, type ProfitabilityRow } from '@/actions/reports'
import { MONTHS, fmtCOP, PeriodNav, ExportCsvButton, ReportTable, Money, type Column } from './shared'


interface Props {
  initialRows:  ProfitabilityRow[]
  initialYear:  number
  initialMonth: number
}

export function ProfitabilityReport({ initialRows, initialYear, initialMonth }: Props) {
  const [year,  setYear]  = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [rows,  setRows]  = useState<ProfitabilityRow[]>(initialRows)
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
      setRows(await getProfitabilityReport(y, m))
    })
  }

  const now = new Date()
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1

  const totalNet         = rows.reduce((s, r) => s + r.net, 0)
  const totalIncome      = rows.reduce((s, r) => s + r.income, 0)
  const totalCleaning    = rows.reduce((s, r) => s + r.cleaning_cost, 0)
  const totalExpenses    = rows.reduce((s, r) => s + r.expenses, 0)
  const totalMaintenance = rows.reduce((s, r) => s + r.maintenance_cost, 0)
  const totalReservations = rows.reduce((s, r) => s + r.reservations, 0)

  // Costs are shown negative (as on the mobile cards), so the row reads income − costs = net.
  const columns: Column<ProfitabilityRow>[] = [
    { header: 'Apartamento',   cell: r => r.property_name },
    { header: 'Reservas',      numeric: true, cell: r => r.reservations, total: totalReservations },
    { header: 'Ingresos',      numeric: true, cell: r => <Money value={r.income} tone="#16a34a" />,
      total: <Money value={totalIncome} tone="#16a34a" /> },
    { header: 'Limpieza',      numeric: true, cell: r => <Money value={-r.cleaning_cost} />,
      total: <Money value={-totalCleaning} /> },
    { header: 'Mantenimiento', numeric: true, cell: r => <Money value={-r.maintenance_cost} />,
      total: <Money value={-totalMaintenance} /> },
    { header: 'Gastos',        numeric: true, cell: r => <Money value={-r.expenses} />,
      total: <Money value={-totalExpenses} /> },
    { header: 'Neto',          numeric: true,
      cell:  r => <b><Money value={r.net} tone="#16a34a" /></b>,
      total: <Money value={totalNet} tone="#16a34a" /> },
  ]

  return (
    <div className="space-y-4">

      {/* ── Month navigator ──────────────────────────────────────────────── */}
      <PeriodNav
        title={`${MONTHS[month - 1]} ${year}`}
        subtitle="Rentabilidad por apartamento"
        pending={isPending}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        nextDisabled={isCurrent}
      />

      <ExportCsvButton
        kind="rentabilidad" year={year} month={month} disabled={isPending}
        headers={columns.map(c => c.header)}
        rows={rows.map(r => [
          r.property_name, r.reservations, r.income,
          -r.cleaning_cost, -r.maintenance_cost, -r.expenses, r.net,
        ])}
        totals={['Total', totalReservations, totalIncome, -totalCleaning, -totalMaintenance, -totalExpenses, totalNet]}
      />

      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">💰</p>
          <p className="text-[#64748b]">Sin datos en {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (
        <>
          {/* ── Headline net ─────────────────────────────────────────────── */}
          <div
            className="rounded-xl px-4 py-4 text-center"
            style={{ background: totalNet >= 0 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${totalNet >= 0 ? '#bbf7d0' : '#fecaca'}` }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide"
               style={{ color: totalNet >= 0 ? '#16a34a' : '#ef4444' }}>
              Ganancia neta del mes
            </p>
            <p className="text-2xl font-bold mt-1"
               style={{ color: totalNet >= 0 ? '#16a34a' : '#ef4444' }}>
              {fmtCOP(totalNet)}
            </p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 text-[11px] text-[#64748b]">
              <span>Ingresos {fmtCOP(totalIncome)}</span>
              <span>Limpieza {fmtCOP(-totalCleaning)}</span>
              {totalMaintenance > 0 && <span>Mant. {fmtCOP(-totalMaintenance)}</span>}
              <span>Gastos {fmtCOP(-totalExpenses)}</span>
            </div>
          </div>

          {/* ── Desktop: one table, every property + totals ──────────────── */}
          <ReportTable
            caption={`Rentabilidad por apartamento, ${MONTHS[month - 1]} ${year}`}
            columns={columns}
            rows={rows}
            rowKey={r => r.property_id}
            totalLabel={`Total ${MONTHS[month - 1]}`}
          />

          {/* ── Mobile: per-property cards ───────────────────────────────── */}
          <div className="space-y-2.5 md:hidden">
            {rows.map(r => {
              const positive = r.net >= 0
              return (
                <div key={r.property_id}
                     className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
                  {/* Header: name + net */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#f1f5f9]">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0f172a] truncate">{r.property_name}</p>
                      <p className="text-[11px] text-[#64748b]">
                        {r.reservations} reserva{r.reservations !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-sm font-bold" style={{ color: positive ? '#16a34a' : '#ef4444' }}>
                        {fmtCOP(r.net)}
                      </span>
                      <span className="text-base" aria-hidden>{positive ? '🟢' : '🔴'}</span>
                    </div>
                  </div>
                  {/* Breakdown */}
                  <div className="px-4 py-2.5 space-y-1">
                    <Line label="Ingresos"      value={r.income}            positive />
                    <Line label="Limpieza"      value={-r.cleaning_cost} />
                    <Line label="Mantenimiento" value={-r.maintenance_cost} />
                    <Line label="Gastos"        value={-r.expenses} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Line({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  const zero = value === 0
  return (
    <div className="flex justify-between text-xs">
      <span className="text-[#64748b]">{label}</span>
      <span className={zero ? 'text-[#64748b]' : positive ? 'text-[#16a34a] font-medium' : 'text-[#ef4444] font-medium'}>
        {zero ? '—' : fmtCOP(value)}
      </span>
    </div>
  )
}
