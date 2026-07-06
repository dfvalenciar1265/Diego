'use client'
import { useState, useTransition } from 'react'
import { assignAndStartTask, updateTaskNotes, updateTaskStatus, setTaskPhoto, type WeekCleaningTask } from '@/actions/tasks'
import { Pagination, paginate, pageCount } from '@/components/ui/Pagination'
import { WeeklyScheduleView } from './WeeklyScheduleView'
import { uploadCleaningPhoto } from '@/lib/upload'
import { useRef } from 'react'
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
    guests: number | null
  } | null
}

interface Props {
  tasks: CleaningTask[]
  staff: TeamMember[]
  weekTasks: WeekCleaningTask[]
  weekStart: string
  todayISO:  string
  currentMember: TeamMember | null
}

type Tab = 'pending' | 'done' | 'week'
const PAGE_SIZE = 5

// Proof-of-clean photo feature — temporarily hidden. Flip to true to re-enable.
const PHOTO_PROOF_ENABLED = false

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

function fmtDatetime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${d.getDate()} ${months[d.getMonth()]} · ${to12h(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)}`
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

export function CleaningView({ tasks, staff, weekTasks, weekStart, todayISO, currentMember }: Props) {
  const today    = todayStr()
  const tomorrow = tomorrowStr()

  const [tab,          setTab]          = useState<Tab>('pending')
  const [todayPage,    setTodayPage]    = useState(1)
  const [tomorrowPage, setTomorrowPage] = useState(1)
  const [laterPage,    setLaterPage]    = useState(1)
  const [donePage,     setDonePage]     = useState(1)

  // Pending = not done
  const activeTasks  = tasks.filter(t => t.status !== 'done')
  const todayTasks   = activeTasks.filter(t => t.scheduled_for === today)
  const tomorrowTasks = activeTasks.filter(t => t.scheduled_for === tomorrow)
  const laterTasks   = activeTasks.filter(t => t.scheduled_for > tomorrow)

  // Done = last 30 days (already filtered in the server action)
  const doneTasks = tasks
    .filter(t => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  const pagedToday    = paginate(todayTasks,    todayPage,    PAGE_SIZE)
  const pagedTomorrow = paginate(tomorrowTasks, tomorrowPage, PAGE_SIZE)
  const pagedLater    = paginate(laterTasks,    laterPage,    PAGE_SIZE)
  const donePages     = pageCount(doneTasks.length, PAGE_SIZE)
  const pagedDone     = paginate(doneTasks, donePage, PAGE_SIZE)

  return (
    <div className="p-4 space-y-3">

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border border-[#e2e8f0]">
        <button
          onClick={() => setTab('pending')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'pending' ? '#6366f1' : 'white',
            color:      tab === 'pending' ? 'white'   : '#64748b',
          }}
        >
          Pendientes
          {activeTasks.length > 0 && (
            <span
              className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{
                background: tab === 'pending' ? 'rgba(255,255,255,0.25)' : '#e0e7ff',
                color:      tab === 'pending' ? 'white' : '#6366f1',
              }}
            >
              {activeTasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('done')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'done' ? '#6366f1' : 'white',
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
        <button
          onClick={() => setTab('week')}
          className="flex-1 py-2.5 text-sm font-medium transition-colors"
          style={{
            background: tab === 'week' ? '#6366f1' : 'white',
            color:      tab === 'week' ? 'white'   : '#64748b',
          }}
        >
          📅 Semana
        </button>
      </div>

      {/* ── Semana tab ─────────────────────────────────────────────────────── */}
      {tab === 'week' && (
        <WeeklyScheduleView
          initialTasks={weekTasks}
          initialWeekStart={weekStart}
          staff={staff}
          todayISO={todayISO}
        />
      )}

      {/* ── Pendientes tab ────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <div className="space-y-5">
          {todayTasks.length === 0 && tomorrowTasks.length === 0 && laterTasks.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="mx-auto mb-3 text-[#94a3b8]" size={40} />
              <p className="text-[#94a3b8]">No hay limpiezas pendientes</p>
            </div>
          ) : (
            <>
              {todayTasks.length > 0 && (
                <Section label="Limpieza hoy" emoji="🧹" count={todayTasks.length} accent="#6366f1" line="#e0e7ff">
                  {pagedToday.map(t => <CleaningTaskCard key={t.id} task={t} staff={staff} currentMember={currentMember} />)}
                  <Pagination
                    page={todayPage}
                    total={pageCount(todayTasks.length, PAGE_SIZE)}
                    onChange={setTodayPage}
                    accent="#6366f1"
                  />
                </Section>
              )}
              {tomorrowTasks.length > 0 && (
                <Section label="Limpieza mañana" emoji="📅" count={tomorrowTasks.length} accent="#94a3b8" line="#e2e8f0">
                  {pagedTomorrow.map(t => <CleaningTaskCard key={t.id} task={t} staff={staff} currentMember={currentMember} locked />)}
                  <Pagination
                    page={tomorrowPage}
                    total={pageCount(tomorrowTasks.length, PAGE_SIZE)}
                    onChange={setTomorrowPage}
                  />
                </Section>
              )}
              {laterTasks.length > 0 && (
                <Section label="Próximas" emoji="📆" count={laterTasks.length} accent="#94a3b8" line="#e2e8f0">
                  {pagedLater.map(t => <CleaningTaskCard key={t.id} task={t} staff={staff} currentMember={currentMember} locked />)}
                  <Pagination
                    page={laterPage}
                    total={pageCount(laterTasks.length, PAGE_SIZE)}
                    onChange={setLaterPage}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Terminadas tab ────────────────────────────────────────────────── */}
      {tab === 'done' && (
        <div className="space-y-3">
          {doneTasks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-[#94a3b8]">No hay limpiezas terminadas recientes</p>
            </div>
          ) : (
            <>
              {pagedDone.map(t => <DoneCleaningCard key={t.id} task={t} />)}
              <Pagination page={donePage} total={donePages} onChange={setDonePage} />
              <p className="text-center text-xs text-[#c4c9d4]">
                {doneTasks.length} limpieza{doneTasks.length !== 1 ? 's' : ''} terminada{doneTasks.length !== 1 ? 's' : ''} (últimos 30 días)
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  label, emoji, count, accent, line, children,
}: {
  label: string; emoji: string; count: number
  accent: string; line: string; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{emoji}</span>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
          {label} ({count})
        </span>
        <div className="flex-1 h-px" style={{ background: line }} />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// ── Done cleaning card (compact) ──────────────────────────────────────────────

function DoneCleaningCard({ task }: { task: CleaningTask }) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 opacity-80">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-[#dcfce7]">
          ✅
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#0f172a] text-sm leading-tight">{task.property?.name ?? '—'}</p>
          <p className="text-xs text-[#94a3b8]">
            {task.assignee?.name ?? 'Sin asignar'} · {fmtDatetime(task.completed_at)}
          </p>
        </div>
        {PHOTO_PROOF_ENABLED && task.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={task.photo_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
            <img src={task.photo_url} alt="Evidencia"
                 className="w-12 h-12 object-cover rounded-lg border border-[#e2e8f0]" />
          </a>
        )}
      </div>
    </div>
  )
}

// ── Active cleaning task card ─────────────────────────────────────────────────

function CleaningTaskCard({
  task,
  staff,
  currentMember,
  locked = false,
}: {
  task: CleaningTask
  staff: TeamMember[]
  currentMember: TeamMember | null
  locked?: boolean   // future cleanings: read-only preview, can't start/finish early
}) {
  const res      = task.reservation
  const resNotes = res?.notes ?? null

  const guestName     = res?.guest_name ?? '—'
  const ciTime        = reservationTimeTo24h(resNotes, 'Check-in')  || '15:00'
  const defaultCoTime = reservationTimeTo24h(resNotes, 'Check-out') || '12:00'
  const savedCoTime   = parseCoTime(task.notes)

  const [coTime, setCoTime]          = useState(savedCoTime || defaultCoTime)
  const [editingCoTime, setEditing]  = useState(false)
  const [pickingPerson, setPicking]  = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [photoUrl, setPhotoUrl]      = useState(task.photo_url)
  const [uploading, setUploading]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const url = await uploadCleaningPhoto(file)
      if (!url) { setError('No se pudo subir la foto. Reintenta.'); return }
      const res = await setTaskPhoto(task.id, url)
      if (!res.success) { setError('No se pudo guardar la foto. Reintenta.'); return }
      setPhotoUrl(url)
    } catch {
      setError('No se pudo subir la foto. Revisa tu conexión.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Field staff often act on spotty building WiFi. A failed mutation must NOT
  // crash the whole page — show a retryable inline error and keep their place.
  function saveCoTime(time: string) {
    setError('')
    startTransition(async () => {
      try {
        const res = await updateTaskNotes(task.id, buildCoAnnotation(time))
        if (!res.success) setError('No se pudo guardar la hora. Revisa tu conexión.')
      } catch {
        setError('No se pudo guardar la hora. Revisa tu conexión.')
      }
    })
  }

  function startWithPerson(memberId: string) {
    setError('')
    startTransition(async () => {
      const res = await assignAndStartTask(task.id, memberId)
      if (!res.success) { setError(res.error ?? 'No se pudo iniciar. Reintenta.'); return }
      setPicking(false)
    })
  }

  // Self-assign: the person tapping "Iniciar" becomes the assignee.
  function startSelf() {
    if (!currentMember) { setError('No se pudo identificar tu usuario. Recarga la página.'); return }
    startWithPerson(currentMember.id)
  }

  const isAdmin = currentMember?.role === 'admin'

  function complete() {
    setError('')
    startTransition(async () => {
      const res = await updateTaskStatus(task.id, 'done')
      if (!res.success) setError('No se pudo marcar como terminada. Revisa tu conexión y reintenta.')
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
        <div className="bg-[#f8fafc] rounded-xl p-2.5">
          <p className="text-[10px] text-[#94a3b8] font-semibold mb-1.5">CHECK-IN</p>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-[#0f172a]">{shortDate(res?.check_in)}</span>
            {ciTime && (
              <span className="text-xs font-semibold text-[#6366f1]">{to12h(ciTime)}</span>
            )}
          </div>
        </div>

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

      {/* Guests + Assignee */}
      <div className="flex items-center gap-3 mb-3">
        {res?.guests != null && (
          <p className="text-xs text-[#64748b] flex items-center gap-1">
            <span>👥</span>
            <span>{res.guests} huésped{res.guests !== 1 ? 'es' : ''}</span>
          </p>
        )}
        {task.assignee && (
          <p className="text-xs text-[#64748b] flex items-center gap-1">
            <span>👤</span>
            <span>{task.assignee.name}</span>
          </p>
        )}
      </div>

      {/* Future cleaning: read-only preview (can't start/finish before check-out day) */}
      {locked && (
        <p className="mt-1 text-[11px] text-[#94a3b8] text-center bg-[#f8fafc] rounded-lg py-1.5">
          📅 Programada — disponible el día del check-out
        </p>
      )}

      {/* Iniciar — non-admin self-assigns; admin picks who cleans */}
      {!locked && task.status === 'pending' && !pickingPerson && (
        <button
          onClick={() => isAdmin ? setPicking(true) : startSelf()}
          disabled={isPending}
          className="mt-1 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#6366f1' }}
        >
          {isPending ? '…' : '▶ Iniciar'}
        </button>
      )}

      {!locked && task.status === 'pending' && pickingPerson && (
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

      {/* Terminar (en curso) — con foto de evidencia opcional si está habilitada */}
      {!locked && task.status === 'in_progress' && (
        PHOTO_PROOF_ENABLED ? (
          <div className="mt-1 space-y-2">
            {/* Hidden camera/file input */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhoto}
            />

            {photoUrl ? (
              <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Evidencia de limpieza"
                     className="w-full h-32 object-cover rounded-lg border border-[#e2e8f0]" />
                <p className="text-[11px] text-[#16a34a] mt-1 text-center">📸 Foto adjunta · tocar para ampliar</p>
              </a>
            ) : null}

            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || isPending}
              className="w-full h-9 rounded-lg text-sm font-semibold border border-[#6366f1] text-[#6366f1]
                         bg-white active:opacity-80 transition-opacity disabled:opacity-50"
            >
              {uploading ? 'Subiendo…' : photoUrl ? '📸 Cambiar foto' : '📸 Tomar foto'}
            </button>

            <button
              onClick={complete}
              disabled={isPending || uploading}
              className="w-full h-9 rounded-lg text-sm font-semibold text-white
                         active:opacity-80 transition-opacity disabled:opacity-50"
              style={{ background: '#22c55e' }}
            >
              {isPending ? '…' : '✓ Terminar'}
            </button>
          </div>
        ) : (
          <button
            onClick={complete}
            disabled={isPending}
            className="mt-1 w-full h-9 rounded-lg text-sm font-semibold text-white
                       active:opacity-80 transition-opacity disabled:opacity-50"
            style={{ background: '#22c55e' }}
          >
            {isPending ? '…' : '✓ Terminar'}
          </button>
        )
      )}

      {/* Retryable error (network/server) — keeps the user's place instead of crashing */}
      {error && (
        <p className="mt-2 text-xs text-[#ef4444] bg-[#fef2f2] rounded-lg px-3 py-2 border border-[#fecaca]">
          ⚠️ {error}
        </p>
      )}
    </div>
  )
}
