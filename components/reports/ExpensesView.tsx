'use client'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { useState, useTransition } from 'react'
import { createExpense, toggleExpenseStatus, deleteExpense } from '@/actions/expenses'
import { toast, useConfirm } from '@/components/ui/feedback'
import { ExportCsvButton } from './shared'
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

function NewExpenseForm({ properties }: { properties: Property[] }) {
  const [open, setOpen]           = useState(false)
  const [isPending, startTrans]   = useTransition()
  const [error, setError]         = useState('')
  const [status, setStatus]       = useState<'pending' | 'paid'>('pending')
  const today = todayInBogota()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const form = e.currentTarget
    const fd = new FormData(form)
    fd.set('status', status)
    startTrans(async () => {
      try {
        const res = await createExpense(fd)
        if (!res.success) {
          const msg = res.error ?? 'No se pudo guardar el gasto'
          setError(msg)
          toast.error(msg)
          return
        }
        toast.success(`Gasto de ${fd.get('provider')} guardado`)
        form.reset()
        setStatus('pending')
        setOpen(false)
        // revalidatePath('/reports') in the action re-renders the page with the new list.
      } catch {
        setError('Sin conexión, reintenta')
        toast.error('No se guardó el gasto, revisa la conexión y reintenta')
      }
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
        <p id="new-expense-status" className="text-xs text-[#64748b] font-medium mb-1.5">Estado</p>
        <div className="flex gap-2" role="group" aria-labelledby="new-expense-status">
          <button type="button"
                  onClick={() => setStatus('pending')}
                  aria-pressed={status === 'pending'}
                  className="flex-1 h-11 rounded-lg text-xs font-semibold transition-colors"
                  style={{
                    background: status === 'pending' ? '#f97316' : '#f8fafc',
                    color:      status === 'pending' ? 'white'   : '#64748b',
                    border:     status === 'pending' ? 'none'    : '1px solid #e2e8f0',
                  }}>
            Por cancelar
          </button>
          <button type="button"
                  onClick={() => setStatus('paid')}
                  aria-pressed={status === 'paid'}
                  className="flex-1 h-11 rounded-lg text-xs font-semibold transition-colors"
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
                className="flex-1 h-11 rounded-lg text-sm border border-[#e2e8f0] text-[#64748b]">
          Cancelar
        </button>
        <button type="submit" disabled={isPending}
                className="flex-1 h-11 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
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
  const confirm = useConfirm()
  const isPaid = expense.status === 'paid'

  function toggle() {
    startTrans(async () => {
      try {
        const res = await toggleExpenseStatus(expense.id, expense.status)
        if (!res.success) { toast.error(res.error ?? 'No se pudo cambiar el estado'); return }
        toast.success(isPaid
          ? `${expense.provider}: marcado como por cancelar`
          : `${expense.provider}: marcado como pagado`)
      } catch {
        toast.error('No se cambió el estado, revisa la conexión y reintenta')
      }
    })
  }

  async function remove() {
    const where = expense.property?.name ? ` · ${expense.property.name}` : ''
    const ok = await confirm({
      title:        `¿Eliminar el gasto de ${expense.provider}?`,
      description:  `${fmtCOP(expense.amount)} del ${shortDate(expense.date)}${where}. ` +
                    'Se borra del reporte de gastos y de la rentabilidad del mes. No se puede deshacer.',
      confirmLabel: 'Eliminar gasto',
      danger:       true,
    })
    if (!ok) return
    startTrans(async () => {
      try {
        const res = await deleteExpense(expense.id)
        if (!res.success) { toast.error(res.error ?? 'No se pudo eliminar el gasto'); return }
        toast.success(`Gasto de ${expense.provider} eliminado`)
      } catch {
        toast.error('No se eliminó el gasto, revisa la conexión y reintenta')
      }
    })
  }

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-[#f1f5f9] last:border-0 ${isPending ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[#0f172a] truncate">{expense.provider}</p>
          <span className="text-[11px] text-[#64748b]">{expense.property?.name}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[#64748b]">{shortDate(expense.date)}</span>
          {expense.notes && (
            <span className="text-xs text-[#64748b] truncate">· {expense.notes}</span>
          )}
        </div>
      </div>

      <span className="text-sm font-semibold text-[#0f172a] flex-shrink-0">
        {fmtCOP(expense.amount)}
      </span>

      {/* Status toggle — 44px tap area around the pill */}
      <button type="button" onClick={toggle} disabled={isPending}
              aria-pressed={isPaid}
              aria-label={`Pagado: ${expense.provider}`}
              title={isPaid ? 'Marcar como por cancelar' : 'Marcar como pagado'}
              className="h-11 flex items-center flex-shrink-0">
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
              style={{
                background: isPaid ? '#dcfce7' : '#ffedd5',
                color:      isPaid ? '#15803d' : '#c2410c',
              }}>
          {isPaid ? 'Pagado' : 'Por cancelar'}
        </span>
      </button>

      {/* Delete */}
      <button type="button" onClick={remove} disabled={isPending}
              aria-label={`Eliminar gasto de ${expense.provider}`}
              className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-[#ef4444] text-sm
                         flex-shrink-0 hover:bg-[#fef2f2]">
        <span aria-hidden>✕</span>
      </button>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface Props {
  expenses:   Expense[]
  properties: Property[]
  year:       number
  month:      number
}

export function ExpensesView({ expenses: list, properties, year, month }: Props) {
  // Read straight from props: each action calls revalidatePath('/reports'), so the page
  // re-renders with the fresh list. (A useState copy here never picked up new expenses.)

  // Totals
  const totalPending = list.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0)
  const totalPaid    = list.filter(e => e.status === 'paid').reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-4">

      {/* Summary chips */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#ffedd5] rounded-xl p-3 text-center">
          <p className="text-[11px] text-[#c2410c] font-semibold uppercase tracking-wide">Por cancelar</p>
          <p className="text-base font-bold text-[#ea580c] mt-0.5">{fmtCOP(totalPending)}</p>
        </div>
        <div className="bg-[#dcfce7] rounded-xl p-3 text-center">
          <p className="text-[11px] text-[#15803d] font-semibold uppercase tracking-wide">Pagado</p>
          <p className="text-base font-bold text-[#16a34a] mt-0.5">{fmtCOP(totalPaid)}</p>
        </div>
      </div>

      <ExportCsvButton
        kind="gastos" year={year} month={month}
        headers={['Fecha', 'Apartamento', 'Proveedor', 'Notas', 'Valor', 'Estado']}
        rows={list.map(e => [
          e.date, e.property?.name ?? '', e.provider, e.notes ?? '', e.amount,
          e.status === 'paid' ? 'Pagado' : 'Por cancelar',
        ])}
        totals={['Total', '', '', '', totalPending + totalPaid, '']}
      />

      {/* New expense form */}
      <NewExpenseForm properties={properties} />

      {/* List */}
      {list.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm text-[#64748b]">Sin gastos registrados este mes</p>
        </div>
      ) : (
        <div className="bg-white border border-[#e2e8f0] rounded-xl px-4 shadow-sm">
          {list.map(e => <ExpenseRow key={e.id} expense={e} />)}
        </div>
      )}
    </div>
  )
}
