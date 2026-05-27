'use client'
import { useState, useTransition } from 'react'
import { assignAndStartTask, updateTaskNotes } from '@/actions/tasks'
import type { Task } from '@/lib/types'
import type { TeamMember } from '@/lib/types'
import { Sparkles } from 'lucide-react'

type CleaningTask = Task & {
  property?: { name: string }
  assignee?: { name: string }
  reservation?: {
    check_in: string
    check_out: string
    notes: string | null
    guest_name: string | null
  } | null
}

interface Props {
  tasks: CleaningTask[]
  staff: TeamMember[]
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function tomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function reservationTimeTo24h(notes: string | null, field: 'Check-in' | 'Check-out'): string {
  if (!notes) return ''
  const re = new RegExp(`${field}:\\s*(\\d+)(?::(\\d+))?\\s*(a|p)\\.?m?\\.?`, 'i')
  const m = notes.match(re)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const mins = m[2] ?? '00'
  const period = m[3].toLowerCase()
  if (period === 'p' && h !== 12) h += 12
  if (period === 'a' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${mins}`
}

function to12h(t: string): string {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

function shortDate(iso: string | undefined): string {
  if (!iso) return '—'
  const [, mm, dd] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(dd, 10)} ${months[parseInt(mm, 10)]}`
}

function parseCoTime(raw: string | null): string {
  if (!raw) return ''
  const m = raw.match(/^(\d{2}:\d{2})\|/)
  if (m) return m[1]
  return ''
}

function buildCoAnnotation(time24: string): string {
  return time24 ? `${time24}|` : ''
}

// ── Main component ────────────────────────────────────────────────────────────

export function CleaningView({ tasks, staff }: Props) {
  const today    = todayStr()
  const tomorrow = tomorrowStr()

  const todayTasks    = tasks.filter(t => t.scheduled_for === today)
  const tomorrowTasks = tasks.filter(t => t.scheduled_for === tomorrow)

  return (
    <div className="p-4 space-y-5">
      {todayTasks.length === 0 && tomorrowTasks.length === 0 ? (
        <div className="text-center py-12">
          <Sparkles className="mx-auto mb-3 text-[#94a3b8]" size={40} />
          <p className="text-[#94a3b8]">No hay limpiezas próximas</p>
        </div>
      ) : (
        <>
          {/* Hoy */}
          {todayTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">🧹</span>
                <span className="text-xs font-semibold text-[#6366f1] uppercase tracking-wide">
                  Limpieza hoy ({todayTasks.length})
                </span>
                <div className="flex-1 h-px bg-[#e0e7ff]" />
              </div>
              <div className="space-y-3">
                {todayTasks.map(task => (
                  <CleaningTaskCard key={task.id} task={task} staff={staff} />
                ))}
              </div>
            </div>
          )}

          {/* Mañana */}
          {tomorrowTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">📅</span>
                <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">
                  Limpieza mañana ({tomorrowTasks.length})
                </span>
                <div className="flex-1 h-px bg-[#e2e8f0]" />
              </div>
              <div className="space-y-3">
                {tomorrowTasks.map(task => (
                  <CleaningTaskCard key={task.id} task={task} staff={staff} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Cleaning task card ────────────────────────────────────────────────────────

function CleaningTaskCard({
  task,
  staff,
}: {
  task: CleaningTask
  staff: TeamMember[]
}) {
  const res      = task.reservation
  const resNotes = res?.notes ?? null

  const guestName    = res?.guest_name ?? '—'
  const ciTime       = reservationTimeTo24h(resNotes, 'Check-in')
  const defaultCoTime = reservationTimeTo24h(resNotes, 'Check-out')
  const savedCoTime   = parseCoTime(task.notes)

  const [coTime, setCoTime]          = useState(savedCoTime || defaultCoTime)
  const [editingCoTime, setEditing]  = useState(false)
  const [pickingPerson, setPicking]  = useState(false)
  const [isPending, startTransition] = useTransition()

  function saveCoTime(time: string) {
    startTransition(async () => {
      await updateTaskNotes(task.id, buildCoAnnotation(time))
    })
  }

  function startWithPerson(memberId: string) {
    startTransition(async () => {
      await assignAndStartTask(task.id, memberId)
      setPicking(false)
    })
  }

  function complete() {
    startTransition(async () => {
      const { updateTaskStatus } = await import('@/actions/tasks')
      await updateTaskStatus(task.id, 'done')
    })
  }

  const statusColors: Record<string, string> = {
    pending:     '#f97316',
    in_progress: '#6366f1',
    done:        '#22c55e',
  }
  const statusLabels: Record<string, string> = {
    pending: 'Pendiente', in_progress: 'En curso', done: 'Completado',
  }

  return (
    <div className="bg-white rounded-xl border border-[#bfdbfe] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">

      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-[#dbeafe]">
          🧹
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#0f172a] text-sm leading-tight">{task.property?.name ?? '—'}</p>
          <p className="text-xs text-[#94a3b8] truncate">{guestName}</p>
        </div>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: `${statusColors[task.status]}22`,
            color:       statusColors[task.status],
          }}
        >
          {statusLabels[task.status]}
        </span>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-2 mb-3">

        {/* Check-in: read-only */}
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1.5">CHECK-IN</p>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-[#0f172a]">{shortDate(res?.check_in)}</span>
            {ciTime && (
              <span className="text-xs font-semibold text-[#6366f1]">{to12h(ciTime)}</span>
            )}
          </div>
        </div>

        {/* Check-out: editable time */}
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1.5">CHECK-OUT</p>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-[#0f172a]">{shortDate(res?.check_out)}</span>
            {editingCoTime ? (
              <input
                type="time"
                autoFocus
                value={coTime}
                onChange={e => setCoTime(e.target.value)}
                onBlur={() => {
                  setEditing(false)
                  saveCoTime(coTime)
                }}
                className="text-xs border border-[#6366f1] rounded-md px-1 py-0.5
                           focus:outline-none bg-white w-[90px]"
              />
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="text-xs font-semibold text-[#6366f1] flex items-center gap-0.5
                           active:opacity-60 transition-opacity"
              >
                {coTime ? to12h(coTime) : '+ hora'} ✏️
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Assignee — when in progress */}
      {task.assignee && (
        <p className="text-xs text-[#64748b] mb-3 flex items-center gap-1.5">
          <span>👤</span>
          <span>{task.assignee.name}</span>
        </p>
      )}

      {/* Iniciar → person picker */}
      {task.status === 'pending' && !pickingPerson && (
        <button
          onClick={() => setPicking(true)}
          disabled={isPending}
          className="mt-1 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#6366f1' }}
        >
          ▶ Iniciar
        </button>
      )}

      {/* Inline person selector */}
      {task.status === 'pending' && pickingPerson && (
        <div className="mt-1 space-y-1.5">
          <p className="text-xs font-semibold text-[#64748b] mb-1.5">
            👤 ¿Quién va a limpiar?
          </p>
          {staff.length === 0 ? (
            <p className="text-xs text-[#94a3b8]">No hay personal registrado</p>
          ) : (
            staff.map(m => (
              <button
                key={m.id}
                onClick={() => startWithPerson(m.id)}
                disabled={isPending}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                           border border-[#e0e7ff] bg-[#f5f3ff] active:bg-[#e0e7ff]
                           transition-colors disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-full bg-[#6366f1] flex items-center justify-center
                                text-white font-bold text-xs flex-shrink-0">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-[#0f172a]">{m.name}</span>
              </button>
            ))
          )}
          <button
            onClick={() => setPicking(false)}
            className="w-full text-xs text-[#94a3b8] py-1 hover:text-[#64748b] transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Terminar */}
      {task.status === 'in_progress' && (
        <button
          onClick={complete}
          disabled={isPending}
          className="mt-1 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#22c55e' }}
        >
          {isPending ? '…' : '✓ Terminar'}
        </button>
      )}
    </div>
  )
}
