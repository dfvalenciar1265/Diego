'use client'
import { useTransition } from 'react'
import { updateMaintenanceStatus } from '@/actions/maintenance'
import { PriorityBadge } from './PriorityBadge'
import { formatDate } from '@/lib/utils'
import type { MaintenanceIssue, MaintenanceStatus } from '@/lib/types'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'

interface Props {
  issue: MaintenanceIssue & {
    property?: { name: string }
    reporter?: { name: string }
    assignee?: { name: string }
  }
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

export function IncidenceCard({ issue }: Props) {
  const [isPending, startTransition] = useTransition()
  const { member } = useCurrentUser()
  const role = member?.role ?? 'cleaning'
  const canManage = canDo(role, 'maintenance:manage')
  const nextStatus = NEXT_STATUS[issue.status]
  const statusColor = STATUS_COLOR[issue.status]

  function advance() {
    if (!nextStatus) return
    startTransition(() => updateMaintenanceStatus(issue.id, nextStatus))
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

        <div className="flex items-center justify-between">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${statusColor}22`, color: statusColor }}>
            {STATUS_LABEL[issue.status]}
          </span>
          {issue.assignee && (
            <span className="text-xs text-[#94a3b8]">🔧 {issue.assignee.name}</span>
          )}
        </div>

        {canManage && nextStatus && (
          <button
            onClick={advance}
            disabled={isPending}
            aria-label={`${nextStatus === 'in_progress' ? 'Iniciar' : 'Resolver'} incidencia en ${issue.property?.name ?? 'propiedad'}`}
            className="mt-3 w-full h-10 rounded-lg text-sm font-semibold text-white
                       active:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: STATUS_COLOR[nextStatus] }}>
            {isPending ? '...' : nextStatus === 'in_progress' ? '▶ Iniciar' : '✓ Resolver'}
          </button>
        )}
      </div>
    </div>
  )
}
