'use client'
import { useState, useTransition } from 'react'
import { createExpense, toggleExpenseStatus, deleteExpense } from '@/actions/expenses'
import type { Expense, Property } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCOP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(n)
}

function shortDate(iso: string) {
  const [, mm, dd] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
                  'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(dd)} ${months[parseInt(mm)]}`
}

// ─── New expense form ─────────────────────────────────────────────────────────

function NewExpenseForm({ properties, onCreated }: {
  properties: Property[]
  onCreated: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, startTrans]   = useTransition()
  const [error, setError]         = useState('')
  const [status, setStatus]       = useState<'pending' | 'paid'>('pending')
  const today = new Date().toISOString().slice(0, 10)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    fd.set('status', status)
    startTrans(async () => {
      const res = await createExpense(fd)
      if (!res.success) { setError(res.error ?? 'Error'); return }
      setOpen(false)
      ;(e.target as HTMLFormElement).reset()
      setStatus('pending')
      onCreated()
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full h-11 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
        style={{ background: '#ff385c' }}
      >
        + Nuevo gasto
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit}
          className="bg-white border border-[#e2e8f0] rounded-xl p-4 space-y-3 shadow-sm">
      <p className="text-sm font-semibold text-[#0f172a]">Nuevo gasto</p>

      {/* Apartamento */}
      <div>
        <label className="text-xs text-[#64748b] font-medium">Apartamento *</label>
        <select name="property_id" required
                className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                           focus:outline-none focus:ring-1 focus:ring-[#ff385c]">
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Proveedor + Fecha */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-[#64748b] font-medium">Proveedor *</label>
          <input name="provider" required placeholder="Ecopetrol, Fontibón…"
                 className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                            focus:outline-none focus:ring-1 focus:ring-[#ff385c]" />
        </div>
        <div>
          <label className="text-xs text-[#64748b] font-medium">Fecha *</label>
          <input name="date" type="date" required defaultValue={today}
                 className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                            focus:outline-none focus:ring-1 focus:ring-[#ff385c]" />
        </div>
      </div>

      {/* Monto */}
      <div>
        <label className="text-xs text-[#64748b] font-medium">Valor (COP) *</label>
        <input name="amount" type="number" min={1} required placeholder="150000"
               className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                          focus:outline-none focus:ring-1 focus:ring-[#ff385c]" />
      </div>

      {/* Estado — toggle button */}
      <div>
        <label className="text-xs text-[#64748b] font-medium block mb-1.5">Estado</label>
        <div className="flex gap-2">
          <button type="button"
                  onClick={() => setStatus('pending')}
                  className="flex-1 h-9 rounded-lg text-xs font-semibold transition-colors"
                  style={{
                    background: status === 'pending' ? '#f97316' : '#f8fafc',
                    color:      status === 'pending' ? 'white'   : '#64748b',
                    border:     status === 'pending' ? 'none'    : '1px solid #e2e8f0',
                  }}>
            Por cancelar
          </button>
          <button type="button"
                  onClick={() => setStatus('paid')}
                  className="flex-1 h-9 rounded-lg text-xs font-semibold transition-colors"
                  style={{
                    background: status === 'paid' ? '#22c55e' : '#f8fafc',
                    color:      status === 'paid' ? 'white'   : '#64748b',
                    border:     status === 'paid' ? 'none'    : '1px solid #e2e8f0',
                  }}>
            Pagado
          </button>
        </div>
      </div>

      {/* Notas opcionales */}
      <div>
        <label className="text-xs text-[#64748b] font-medium">Notas (opcional)</label>
        <input name="notes" placeholder="Descripción adicional…"
               className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                          focus:outline-none focus:ring-1 focus:ring-[#ff385c]" />
      </div>

      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => { setOpen(false); setError('') }}
                className="flex-1 h-10 rounded-lg text-sm border border-[#e2e8f0] text-[#64748b]">
          Cancelar
        </button>
        <button type="submit" disabled={isPending}
                className="flex-1 h-10 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#ff385c' }}>
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ─── Single expense row ───────────────────────────────────────────────────────

function ExpenseRow({ expense }: { expense: Expense }) {
  const [isPending, startTrans] = useTransition()

  function toggle() {
    startTrans(async () => { await toggleExpenseStatus(expense.id, expense.status) })
  }

  function remove() {
    if (!confirm(`¿Eliminar gasto de ${expense.provider}?`)) return
    startTrans(async () => { await deleteExpense(expense.id) })
  }

  const isPaid = expense.status === 'paid'

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-[#f1f5f9] last:border-0 ${isPending ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[#0f172a] truncate">{expense.provider}</p>
          <span className="text-[10px] text-[#94a3b8]">{expense.property?.name}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[#94a3b8]">{shortDate(expense.date)}</span>
          {expense.notes && (
            <span className="text-xs text-[#94a3b8] truncate">· {expense.notes}</span>
          )}
        </div>
      </div>

      <span className="text-sm font-semibold text-[#0f172a] flex-shrink-0">
        {fmtCOP(expense.amount)}
      </span>

      {/* Status toggle */}
      <button onClick={toggle} disabled={isPending}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 transition-colors"
              style={{
                background: isPaid ? '#dcfce7' : '#ffedd5',
                color:      isPaid ? '#16a34a' : '#ea580c',
              }}>
        {isPaid ? 'Pagado' : 'Por cancelar'}
      </button>

      {/* Delete */}
      <button onClick={remove} disabled={isPending}
              className="text-[#ef4444] text-xs flex-shrink-0 opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface Props {
  expenses:   Expense[]
  properties: Property[]
}

export function ExpensesView({ expenses, properties }: Props) {
  const [list, setList] = useState(expenses)

  // Totals
  const totalPending = list.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0)
  const totalPaid    = list.filter(e => e.status === 'paid').reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-4">

      {/* Summary chips */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#ffedd5] rounded-xl p-3 text-center">
          <p className="text-[10px] text-[#ea580c] font-semibold uppercase tracking-wide">Por cancelar</p>
          <p className="text-base font-bold text-[#ea580c] mt-0.5">{fmtCOP(totalPending)}</p>
        </div>
        <div className="bg-[#dcfce7] rounded-xl p-3 text-center">
          <p className="text-[10px] text-[#16a34a] font-semibold uppercase tracking-wide">Pagado</p>
          <p className="text-base font-bold text-[#16a34a] mt-0.5">{fmtCOP(totalPaid)}</p>
        </div>
      </div>

      {/* New expense form */}
      <NewExpenseForm
        properties={properties}
        onCreated={() => setList(list)} // Server revalidation will refresh
      />

      {/* List */}
      {list.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm text-[#94a3b8]">Sin gastos registrados este mes</p>
        </div>
      ) : (
        <div className="bg-white border border-[#e2e8f0] rounded-xl px-4 shadow-sm">
          {list.map(e => <ExpenseRow key={e.id} expense={e} />)}
        </div>
      )}
    </div>
  )
}
