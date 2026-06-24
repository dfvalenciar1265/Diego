'use client'
import { useState, useTransition } from 'react'
import { completeTask, updateTaskStatus } from '@/actions/tasks'
import { formatDate } from '@/lib/utils'
import { isTaskOverdue } from '@/lib/utils'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'
import type { Task, TeamMember } from '@/lib/types'

interface Props {
  task: Task & { property?: { name: string }; assignee?: { name: string } }
  teamMembers: TeamMember[]
  onEdit?: () => void
}

export function OtherTaskCard({ task, teamMembers, onEdit }: Props) {
  const [isPending, startTransition] = useTransition()
  const { member } = useCurrentUser()
  const role = member?.role ?? 'cleaning'
  const canManage = canDo(role, 'tasks:create')

  const [completing, setCompleting] = useState(false)
  const [compNotes, setCompNotes]   = useState('')
  const [compCost,  setCompCost]    = useState('')
  const [compPerson, setCompPerson] = useState(task.assigned_to ?? '')
  const [error, setError]           = useState('')

  const overdue = isTaskOverdue(task.scheduled_for, task.status)

  function startComplete() {
    setCompPerson(task.assigned_to ?? '')
    setCompleting(true)
  }

  function cancelComplete() {
    setCompleting(false)
    setCompNotes('')
    setCompCost('')
  }

  function submitComplete() {
    setError('')
    startTransition(async () => {
      const res = await completeTask(task.id, {
        notes:      compNotes || undefined,
        cost:       compCost ? parseFloat(compCost) : undefined,
        assignedTo: compPerson || undefined,
      })
      if (!res.success) { setError(res.error ?? 'No se pudo completar. Reintenta.'); return }
      setCompleting(false)
    })
  }

  function advance() {
    setError('')
    startTransition(async () => {
      const res = await updateTaskStatus(task.id, 'in_progress')
      if (!res.success) setError('No se pudo iniciar. Revisa tu conexión.')
    })
  }

  const statusColor: Record<string, string> = {
    pending:     '#f97316',
    in_progress: '#6366f1',
    done:        '#22c55e',
  }
  const statusLabel: Record<string, string> = {
    pending:     'Pendiente',
    in_progress: 'En proceso',
    done:        'Terminada',
  }

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden
                     ${overdue && task.status !== 'done' ? 'border-[#ef4444]' : 'border-[#e2e8f0]'}`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
            style={{ backgroundColor: `${statusColor[task.status]}22` }}
          >
            📋
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[#0f172a] text-sm">{task.property?.name ?? '—'}</p>
              {overdue && task.status !== 'done' && (
                <span className="text-[10px] bg-[#fee2e2] text-[#ef4444] px-2 py-0.5 rounded-full font-semibold">
                  ATRASADA
                </span>
              )}
            </div>
            <p className="text-xs text-[#94a3b8] mt-0.5">
              {task.assignee?.name ?? 'Sin asignar'} · {formatDate(task.scheduled_for)}
            </p>
          </div>
          <span
            className="text-xs font-medium px-2 py-1 rounded-full flex-shrink-0"
            style={{ backgroundColor: `${statusColor[task.status]}22`, color: statusColor[task.status] }}
          >
            {statusLabel[task.status]}
          </span>
        </div>

        {/* Notes */}
        {task.notes && (
          <p className="text-xs text-[#64748b] mb-3 italic">{task.notes}</p>
        )}

        {/* Cost + done info */}
        {task.status === 'done' && (
          <div className="flex items-center gap-3 mb-1 text-xs text-[#64748b]">
            <span className="text-[#22c55e]">✅ Completada</span>
            {task.cost != null && (
              <span>💰 ${task.cost.toLocaleString('es-CO')}</span>
            )}
          </div>
        )}

        {/* Iniciar button */}
        {task.status === 'pending' && !completing && canManage && (
          <button
            onClick={advance}
            disabled={isPending}
            className="mt-2 w-full h-9 rounded-lg text-sm font-semibold text-white
                       active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: '#6366f1' }}
          >
            {isPending ? '…' : '▶ Iniciar'}
          </button>
        )}

        {/* Completar button → inline form */}
        {task.status === 'in_progress' && !completing && (
          <button
            onClick={startComplete}
            disabled={isPending}
            className="mt-2 w-full h-9 rounded-lg text-sm font-semibold text-white
                       active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: '#22c55e' }}
          >
            ✓ Completar
          </button>
        )}

        {/* Inline completion form */}
        {completing && (
          <div className="mt-3 space-y-3 border-t border-[#f1f5f9] pt-3">
            <p className="text-xs font-semibold text-[#64748b]">📝 Registrar antes de completar</p>

            {/* Person */}
            <div>
              <label className="text-[10px] text-[#94a3b8] font-semibold uppercase tracking-wide mb-1 block">
                Persona
              </label>
              <select
                value={compPerson}
                onChange={e => setCompPerson(e.target.value)}
                className="w-full text-sm text-[#0f172a] bg-[#f8fafc] border border-[#e2e8f0]
                           rounded-xl px-3 py-2 focus:outline-none"
              >
                <option value="">Sin especificar</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] text-[#94a3b8] font-semibold uppercase tracking-wide mb-1 block">
                ¿Qué se hizo?
              </label>
              <input
                type="text"
                value={compNotes}
                onChange={e => setCompNotes(e.target.value)}
                placeholder="Descripción breve..."
                className="w-full text-sm text-[#0f172a] bg-[#f8fafc] border border-[#e2e8f0]
                           rounded-xl px-3 py-2 focus:outline-none"
              />
            </div>

            {/* Cost */}
            <div>
              <label className="text-[10px] text-[#94a3b8] font-semibold uppercase tracking-wide mb-1 block">
                Costo ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={compCost}
                onChange={e => setCompCost(e.target.value)}
                placeholder="0"
                className="w-full text-sm text-[#0f172a] bg-[#f8fafc] border border-[#e2e8f0]
                           rounded-xl px-3 py-2 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={cancelComplete}
                disabled={isPending}
                className="h-9 rounded-lg text-sm font-medium text-[#64748b]
                           border border-[#e2e8f0] active:opacity-70"
              >
                Cancelar
              </button>
              <button
                onClick={submitComplete}
                disabled={isPending}
                className="h-9 rounded-lg text-sm font-semibold text-white
                           active:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: '#22c55e' }}
              >
                {isPending ? '…' : '✓ Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* Editar — disponible para quien gestiona tareas */}
        {canManage && !completing && onEdit && (
          <button
            onClick={onEdit}
            disabled={isPending}
            className="mt-2 w-full h-8 rounded-lg text-xs font-medium text-[#64748b]
                       border border-[#e2e8f0] active:opacity-70 disabled:opacity-50"
          >
            ✏️ Editar
          </button>
        )}

        {error && (
          <p className="mt-2 text-xs text-[#ef4444] bg-[#fef2f2] rounded-lg px-3 py-2 border border-[#fecaca]">
            ⚠️ {error}
          </p>
        )}
      </div>
    </div>
  )
}
