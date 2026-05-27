'use client'
import { useState } from 'react'
import { TaskCard } from './TaskCard'
import type { Task } from '@/lib/types'

type ExtendedTask = Task & { property?: { name: string }; assignee?: { name: string } }

interface Props {
  tasks: ExtendedTask[]
}

type Tab = 'pending' | 'done'

const PAGE_SIZE = 5

export function TasksView({ tasks }: Props) {
  const [tab, setTab]   = useState<Tab>('pending')
  const [page, setPage] = useState(1)

  const pendingTasks = tasks.filter(t => t.status !== 'done')
  const doneTasks    = tasks.filter(t => t.status === 'done')
    .sort((a, b) => {
      // Most recently completed first
      const dateA = a.completed_at ?? a.scheduled_for
      const dateB = b.completed_at ?? b.scheduled_for
      return dateB.localeCompare(dateA)
    })

  // Pagination for done tasks
  const totalPages  = Math.max(1, Math.ceil(doneTasks.length / PAGE_SIZE))
  const pagedDone   = doneTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function switchTab(t: Tab) {
    setTab(t)
    setPage(1)
  }

  return (
    <div className="p-4 space-y-4">

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border border-[#e2e8f0]">
        <button
          onClick={() => switchTab('pending')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'pending' ? '#ff385c' : 'white',
            color:      tab === 'pending' ? 'white'   : '#64748b',
          }}
        >
          Pendientes
          {pendingTasks.length > 0 && (
            <span
              className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{
                background: tab === 'pending' ? 'rgba(255,255,255,0.25)' : '#fee2e2',
                color:      tab === 'pending' ? 'white' : '#ef4444',
              }}
            >
              {pendingTasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => switchTab('done')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'done' ? '#ff385c' : 'white',
            color:      tab === 'done' ? 'white'   : '#64748b',
          }}
        >
          Terminadas
          {doneTasks.length > 0 && (
            <span
              className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{
                background: tab === 'done' ? 'rgba(255,255,255,0.25)' : '#dcfce7',
                color:      tab === 'done' ? 'white' : '#16a34a',
              }}
            >
              {doneTasks.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Pendientes ───────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <div className="space-y-3">
          {pendingTasks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-[#94a3b8]">No hay tareas pendientes</p>
            </div>
          ) : (
            pendingTasks.map(t => <TaskCard key={t.id} task={t} />)
          )}
        </div>
      )}

      {/* ── Terminadas + paginación ───────────────────────────────────────── */}
      {tab === 'done' && (
        <div className="space-y-3">
          {doneTasks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-[#94a3b8]">No hay tareas terminadas</p>
            </div>
          ) : (
            <>
              {pagedDone.map(t => <TaskCard key={t.id} task={t} />)}

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex items-center gap-1 text-sm font-medium text-[#6366f1]
                               disabled:text-[#c4c9d4] disabled:cursor-not-allowed
                               active:opacity-70 transition-opacity"
                  >
                    ‹ Anterior
                  </button>

                  <span className="text-xs text-[#94a3b8]">
                    {page} / {totalPages}
                  </span>

                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="flex items-center gap-1 text-sm font-medium text-[#6366f1]
                               disabled:text-[#c4c9d4] disabled:cursor-not-allowed
                               active:opacity-70 transition-opacity"
                  >
                    Siguiente ›
                  </button>
                </div>
              )}

              <p className="text-center text-xs text-[#c4c9d4]">
                {doneTasks.length} tarea{doneTasks.length !== 1 ? 's' : ''} completada{doneTasks.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
