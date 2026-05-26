'use client'
import { useTransition } from 'react'
import { updateTaskStatus } from '@/actions/tasks'
import { getTaskStatusLabel, getTaskStatusColor, isTaskOverdue, formatDate } from '@/lib/utils'
import type { Task, TaskStatus } from '@/lib/types'

interface Props {
  task: Task & { property?: { name: string }; assignee?: { name: string } }
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: null,
}

const TYPE_ICON: Record<string, string> = {
  cleaning: '🧹',
  preparation: '🛏️',
  other: '📋',
}

export function TaskCard({ task }: Props) {
  const [isPending, startTransition] = useTransition()
  const nextStatus = NEXT_STATUS[task.status]
  const overdue = isTaskOverdue(task.scheduled_for, task.status)
  const color = getTaskStatusColor(task.status)

  function advance() {
    if (!nextStatus) return
    startTransition(() => updateTaskStatus(task.id, nextStatus))
  }

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4
                     ${overdue ? 'border-[#ef4444]' : 'border-[#e2e8f0]'}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
             style={{ backgroundColor: `${color}22` }}>
          {TYPE_ICON[task.type] ?? '📋'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-[#0f172a] text-sm">{task.property?.name ?? '—'}</p>
            {overdue && (
              <span className="text-[10px] bg-[#fee2e2] text-[#ef4444] px-2 py-0.5 rounded-full font-semibold">
                ATRASADA
              </span>
            )}
          </div>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            {task.assignee?.name ?? 'Sin asignar'} · {formatDate(task.scheduled_for)}
          </p>
          {task.notes && (
            <p className="text-xs text-[#64748b] mt-1 italic">{task.notes}</p>
          )}
        </div>
        <span className="text-xs font-medium px-2 py-1 rounded-full flex-shrink-0"
              style={{ backgroundColor: `${color}22`, color }}>
          {getTaskStatusLabel(task.status)}
        </span>
      </div>

      {nextStatus && (
        <button onClick={advance} disabled={isPending}
                className="mt-3 w-full h-10 rounded-lg text-sm font-semibold
                           active:opacity-80 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: getTaskStatusColor(nextStatus), color: 'white' }}>
          {isPending ? '...' : nextStatus === 'in_progress' ? '▶ Iniciar' : '✓ Completar'}
        </button>
      )}

      {task.status === 'done' && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm">✅</span>
          <span className="text-xs text-[#22c55e] font-medium">
            Completado{task.completed_at ? ` · ${formatDate(task.completed_at.split('T')[0])}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
