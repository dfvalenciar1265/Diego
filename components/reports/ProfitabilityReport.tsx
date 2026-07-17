'use client'
import { useState, useTransition } from 'react'
import { getProfitabilityReport, type ProfitabilityRow } from '@/actions/reports'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmtCOP(n: number): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString('es-CO')}`
}

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

  return (
    <div className="space-y-4">

      {/* ── Month navigator ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-[#e2e8f0] px-4 py-3 shadow-sm">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6366f1] font-bold text-xl active:opacity-60"
        >‹</button>
        <div className="text-center">
          <p className="text-sm font-bold text-[#0f172a] capitalize">
            {isPending ? '…' : `${MONTHS[month - 1]} ${year}`}
          </p>
          <p className="text-[10px] text-[#94a3b8] uppercase tracking-wide">Rentabilidad por apartamento</p>
        </div>
        <button
          onClick={() => navigate(1)}
          disabled={isCurrent}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6366f1] font-bold text-xl active:opacity-60 disabled:text-[#cbd5e1]"
        >›</button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">💰</p>
          <p className="text-[#94a3b8]">Sin datos en {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (
        <>
          {/* ── Headline net ─────────────────────────────────────────────── */}
          <div
            className="rounded-xl px-4 py-4 text-center"
            style={{ background: totalNet >= 0 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${totalNet >= 0 ? '#bbf7d0' : '#fecaca'}` }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide"
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

          {/* ── Per-property cards ───────────────────────────────────────── */}
          <div className="space-y-2.5">
            {rows.map(r => {
              const positive = r.net >= 0
              return (
                <div key={r.property_id}
                     className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
                  {/* Header: name + net */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#f1f5f9]">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0f172a] truncate">{r.property_name}</p>
                      <p className="text-[11px] text-[#94a3b8]">
                        {r.reservations} reserva{r.reservations !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-sm font-bold" style={{ color: positive ? '#16a34a' : '#ef4444' }}>
                        {fmtCOP(r.net)}
                      </span>
                      <span className="text-base">{positive ? '🟢' : '🔴'}</span>
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
      <span className={zero ? 'text-[#cbd5e1]' : positive ? 'text-[#16a34a] font-medium' : 'text-[#ef4444] font-medium'}>
        {zero ? '—' : fmtCOP(value)}
      </span>
    </div>
  )
}
