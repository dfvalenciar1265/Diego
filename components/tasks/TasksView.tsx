'use client'
import { useState } from 'react'
import { TaskCard } from './TaskCard'
import type { Task, Property } from '@/lib/types'

type ExtendedTask = Task & { property?: { name: string }; assignee?: { name: string } }

interface Props {
  tasks:      ExtendedTask[]
  properties: Property[]
}

type Tab = 'pending' | 'done'

const PAGE_SIZE = 5

const TYPE_OPTIONS = [
  { value: '',            label: 'Todos los tipos' },
  { value: 'cleaning',    label: '🧹 Limpieza'     },
  { value: 'preparation', label: '🛏️ Preparación'  },
  { value: 'other',       label: '📋 Otra'          },
]

// ── Pagination helper ─────────────────────────────────────────────────────────

function Pagination({
  page, total, onChange,
}: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="text-sm font-medium text-[#6366f1]
                   disabled:text-[#c4c9d4] active:opacity-70 transition-opacity"
      >
        ‹ Anterior
      </button>
      <span className="text-xs text-[#94a3b8]">{page} / {total}</span>
      <button
        onClick={() => onChange(Math.min(total, page + 1))}
        disabled={page === total}
        className="text-sm font-medium text-[#6366f1]
                   disabled:text-[#c4c9d4] active:opacity-70 transition-opacity"
      >
        Siguiente ›
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TasksView({ tasks, properties }: Props) {
  const [tab,        setTab]        = useState<Tab>('pending')
  const [pendPage,   setPendPage]   = useState(1)
  const [donePage,   setDonePage]   = useState(1)
  const [filterProp, setFilterProp] = useState('')
  const [filterType, setFilterType] = useState('')

  // ── Apply filters ─────────────────────────────────────────────────────────
  const filtered = tasks.filter(t => {
    if (filterProp && t.property_id !== filterProp) return false
    if (filterType && t.type       !== filterType)  return false
    return true
  })

  const pendingTasks = filtered.filter(t => t.status !== 'done')
  const doneTasks    = filtered
    .filter(t => t.status === 'done')
    .sort((a, b) => {
      const dateA = a.completed_at ?? a.scheduled_for
      const dateB = b.completed_at ?? b.scheduled_for
      return dateB.localeCompare(dateA)
    })

  // ── Pagination ────────────────────────────────────────────────────────────
  const pendPages = Math.max(1, Math.ceil(pendingTasks.length / PAGE_SIZE))
  const donePages = Math.max(1, Math.ceil(doneTasks.length  / PAGE_SIZE))

  const pagedPending = pendingTasks.slice((pendPage - 1) * PAGE_SIZE, pendPage * PAGE_SIZE)
  const pagedDone    = doneTasks.slice((donePage  - 1) * PAGE_SIZE, donePage  * PAGE_SIZE)

  function switchTab(t: Tab) {
    setTab(t)
  }

  function handleFilterChange(prop: string, type: string) {
    setFilterProp(prop)
    setFilterType(type)
    setPendPage(1)
    setDonePage(1)
  }

  return (
    <div className="p-4 space-y-3">

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={filterProp}
          onChange={e => handleFilterChange(e.target.value, filterType)}
          className="w-full text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                     rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1
                     focus:ring-[#ff385c] appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="">Todos los apts.</option>
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={e => handleFilterChange(filterProp, e.target.value)}
          className="w-full text-sm text-[#0f172a] bg-white border border-[#e2e8f0]
                     rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1
                     focus:ring-[#ff385c] appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          {TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
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

      {/* ── Pendientes ────────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <div className="space-y-3">
          {pendingTasks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-[#94a3b8]">No hay tareas pendientes</p>
            </div>
          ) : (
            <>
              {pagedPending.map(t => <TaskCard key={t.id} task={t} />)}
              <Pagination page={pendPage} total={pendPages} onChange={setPendPage} />
              <p className="text-center text-xs text-[#c4c9d4]">
                {pendingTasks.length} tarea{pendingTasks.length !== 1 ? 's' : ''} pendiente{pendingTasks.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Terminadas ────────────────────────────────────────────────────── */}
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
              <Pagination page={donePage} total={donePages} onChange={setDonePage} />
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
