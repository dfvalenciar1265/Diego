'use client'
import { useState, useTransition } from 'react'
import { updateMaintenanceStatus } from '@/actions/maintenance'
import { PriorityBadge } from './PriorityBadge'
import { formatDate } from '@/lib/utils'
import type { MaintenanceIssue, MaintenanceStatus, TeamMember } from '@/lib/types'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'

interface Props {
  issue: MaintenanceIssue & {
    property?: { name: string }
    reporter?: { name: string }
    assignee?: { name: string }
  }
  teamMembers?: TeamMember[]
}

const NEXT_STATUS: Partial<Record<MaintenanceStatus, MaintenanceStatus>> = {
  open: 'in_progress',
  in_progress: 'resolved',
}

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  open: 'Abierto',
  in_progress: 'En proceso',
  resolved: 'Resuelto',
}

const STATUS_COLOR: Record<MaintenanceStatus, string> = {
  open: '#ef4444',
  in_progress: '#f97316',
  resolved: '#22c55e',
}

export function IncidenceCard({ issue, teamMembers = [] }: Props) {
  const [isPending, startTransition] = useTransition()
  const { member } = useCurrentUser()
  const role = member?.role ?? 'cleaning'
  const canManage = canDo(role, 'maintenance:manage')
  const nextStatus = NEXT_STATUS[issue.status]
  const statusColor = STATUS_COLOR[issue.status]

  // Inline resolve form state (only shown when nextStatus === 'resolved')
  const [resolving, setResolving]     = useState(false)
  const [resNotes, setResNotes]       = useState('')
  const [resCost, setResCost]         = useState('')
  const [resPerson, setResPerson]     = useState(issue.assigned_to ?? '')

  function advance() {
    if (!nextStatus) return
    if (nextStatus === 'resolved') {
      setResPerson(issue.assigned_to ?? '')
      setResolving(true)
      return
    }
    startTransition(() => updateMaintenanceStatus(issue.id, nextStatus))
  }

  function cancelResolve() {
    setResolving(false)
    setResNotes('')
    setResCost('')
  }

  function submitResolve() {
    startTransition(async () => {
      await updateMaintenanceStatus(issue.id, 'resolved', {
        notes:      resNotes || undefined,
        cost:       resCost ? parseFloat(resCost) : undefined,
        assignedTo: resPerson || undefined,
      })
      setResolving(false)
    })
  }

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden
                     ${issue.priority === 'urgent' ? 'border-[#ef4444]' : 'border-[#e2e8f0]'}`}>
      {issue.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={issue.photo_url} alt="Foto de incidencia"
             className="w-full h-32 object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#0f172a] text-sm">{issue.title}</p>
            <p className="text-xs text-[#94a3b8]">
              {issue.property?.name} · {formatDate(issue.created_at.split('T')[0])}
            </p>
          </div>
          <PriorityBadge priority={issue.priority} />
        </div>

        {issue.description && (
          <p className="text-xs text-[#64748b] mb-3">{issue.description}</p>
        )}

        <div className="flex items-center justify-between mb-1">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${statusColor}22`, color: statusColor }}>
            {STATUS_LABEL[issue.status]}
          </span>
          {issue.assignee && (
            <span className="text-xs text-[#94a3b8]">🔧 {issue.assignee.name}</span>
          )}
        </div>

        {/* Cost + notes when resolved */}
        {issue.status === 'resolved' && (issue.cost != null || issue.notes) && (
          <div className="flex items-center gap-3 mt-1 text-xs text-[#64748b]">
            {issue.notes && <span className="italic truncate">{issue.notes}</span>}
            {issue.cost != null && (
              <span className="flex-shrink-0">💰 ${issue.cost.toLocaleString('es-CO')}</span>
            )}
          </div>
        )}

        {/* Advance button (open → in_progress) */}
        {canManage && nextStatus && nextStatus !== 'resolved' && !resolving && (
          <button
            onClick={advance}
            disabled={isPending}
            aria-label={`Iniciar incidencia en ${issue.property?.name ?? 'propiedad'}`}
            className="mt-3 w-full h-10 rounded-lg text-sm font-semibold text-white
                       active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: STATUS_COLOR[nextStatus] }}>
            {isPending ? '...' : '▶ Iniciar'}
          </button>
        )}

        {/* Resolver button → shows inline form */}
        {canManage && nextStatus === 'resolved' && !resolving && (
          <button
            onClick={advance}
            disabled={isPending}
            aria-label={`Resolver incidencia en ${issue.property?.name ?? 'propiedad'}`}
            className="mt-3 w-full h-10 rounded-lg text-sm font-semibold text-white
                       active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: '#22c55e' }}>
            ✓ Resolver
          </button>
        )}

        {/* Inline resolve form */}
        {resolving && (
          <div className="mt-3 space-y-3 border-t border-[#f1f5f9] pt-3">
            <p className="text-xs font-semibold text-[#64748b]">📝 Registrar antes de resolver</p>

            {/* Person */}
            {teamMembers.length > 0 && (
              <div>
                <label className="text-[10px] text-[#94a3b8] font-semibold uppercase tracking-wide mb-1 block">
                  Persona que lo resolvió
                </label>
                <select
                  value={resPerson}
                  onChange={e => setResPerson(e.target.value)}
                  className="w-full text-sm text-[#0f172a] bg-[#f8fafc] border border-[#e2e8f0]
                             rounded-xl px-3 py-2 focus:outline-none"
                >
                  <option value="">Sin especificar</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-[10px] text-[#94a3b8] font-semibold uppercase tracking-wide mb-1 block">
                ¿Qué se hizo?
              </label>
              <input
                type="text"
                value={resNotes}
                onChange={e => setResNotes(e.target.value)}
                placeholder="Descripción de la solución..."
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
                value={resCost}
                onChange={e => setResCost(e.target.value)}
                placeholder="0"
                className="w-full text-sm text-[#0f172a] bg-[#f8fafc] border border-[#e2e8f0]
                           rounded-xl px-3 py-2 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={cancelResolve}
                disabled={isPending}
                className="h-9 rounded-lg text-sm font-medium text-[#64748b]
                           border border-[#e2e8f0] active:opacity-70"
              >
                Cancelar
              </button>
              <button
                onClick={submitResolve}
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
      </div>
    </div>
  )
}
