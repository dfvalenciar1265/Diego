'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { assignTask, assignAndStartTask } from '@/actions/tasks'
import { createTeamMember, deactivateTeamMember } from '@/actions/team'
import { formatDate } from '@/lib/utils'
import { useUserRole } from '@/lib/user-context'
import type { Task } from '@/lib/types'
import type { TeamMember } from '@/lib/types'
import { UserPlus, ChevronRight, Sparkles } from 'lucide-react'

type CleaningTask = Task & { property?: { name: string }; assignee?: { name: string } }

interface Props {
  tasks:  CleaningTask[]
  staff:  TeamMember[]
}

// ── Tab ───────────────────────────────────────────────────────────────────────

type Tab = 'limpiezas' | 'personal'

// ── Main component ────────────────────────────────────────────────────────────

export function CleaningView({ tasks, staff }: Props) {
  const [tab, setTab] = useState<Tab>('limpiezas')
  const [assignSheet, setAssignSheet] = useState<CleaningTask | null>(null)
  const [addStaffOpen, setAddStaffOpen] = useState(false)
  const role = useUserRole()
  const isAdmin = role === 'admin'

  return (
    <div className="p-4 space-y-4">

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border border-[#e2e8f0]">
        {(['limpiezas', 'personal'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2.5 text-sm font-medium capitalize transition-colors"
            style={{
              background: tab === t ? '#ff385c' : 'white',
              color:      tab === t ? 'white'   : '#64748b',
            }}
          >
            {t === 'limpiezas' ? '🧹 Limpiezas' : '👥 Personal'}
          </button>
        ))}
      </div>

      {/* ── Limpiezas tab ────────────────────────────────────────────────── */}
      {tab === 'limpiezas' && (
        <div className="space-y-3">
          {tasks.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="mx-auto mb-3 text-[#94a3b8]" size={40} />
              <p className="text-[#94a3b8]">No hay limpiezas próximas</p>
            </div>
          ) : (
            tasks.map(task => (
              <CleaningTaskCard
                key={task.id}
                task={task}
                staff={staff}
                isAdmin={isAdmin}
                onAssign={() => setAssignSheet(task)}
              />
            ))
          )}
        </div>
      )}

      {/* ── Personal tab ─────────────────────────────────────────────────── */}
      {tab === 'personal' && (
        <div className="space-y-3">
          {isAdmin && (
            <button
              onClick={() => setAddStaffOpen(true)}
              className="w-full flex items-center justify-center gap-2 h-11 rounded-xl
                         border-2 border-dashed border-[#e2e8f0] text-sm text-[#64748b]
                         hover:border-[#ff385c] hover:text-[#ff385c] transition-colors"
            >
              <UserPlus size={16} />
              Agregar persona de limpieza
            </button>
          )}

          {staff.length === 0 ? (
            <p className="text-center text-[#94a3b8] text-sm py-8">
              No hay personal de limpieza registrado
            </p>
          ) : (
            staff.map(member => (
              <StaffCard key={member.id} member={member} isAdmin={isAdmin} />
            ))
          )}
        </div>
      )}

      {/* ── Assign cleaner bottom sheet ───────────────────────────────────── */}
      {assignSheet && (
        <AssignSheet
          task={assignSheet}
          staff={staff}
          onClose={() => setAssignSheet(null)}
        />
      )}

      {/* ── Add staff bottom sheet ────────────────────────────────────────── */}
      {addStaffOpen && (
        <AddStaffSheet onClose={() => setAddStaffOpen(false)} />
      )}
    </div>
  )
}

// ── Cleaning task card ────────────────────────────────────────────────────────

function CleaningTaskCard({
  task, staff, isAdmin, onAssign,
}: {
  task: CleaningTask
  staff: TeamMember[]
  isAdmin: boolean
  onAssign: () => void
}) {
  const [isPending, startTransition] = useTransition()
  // When pending: shows person selector before starting
  const [pickingPerson, setPickingPerson] = useState(false)

  function complete() {
    startTransition(async () => {
      const { updateTaskStatus } = await import('@/actions/tasks')
      await updateTaskStatus(task.id, 'done')
    })
  }

  function startWithPerson(memberId: string) {
    startTransition(async () => {
      await assignAndStartTask(task.id, memberId)
      setPickingPerson(false)
    })
  }

  // Extract guest name from notes: "Limpieza post-estadía — Nombre"
  const guestNote = task.notes?.split('—')[1]?.trim() ?? task.notes ?? ''

  const statusColors: Record<string, string> = {
    pending:     '#f97316',
    in_progress: '#6366f1',
    done:        '#22c55e',
  }
  const statusLabels: Record<string, string> = {
    pending: 'Pendiente', in_progress: 'En curso', done: 'Completado',
  }

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-[#fff0f2]">
          🧹
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#0f172a] text-sm">{task.property?.name ?? '—'}</p>
          <p className="text-xs text-[#64748b] mt-0.5">Check-out: {formatDate(task.scheduled_for)}</p>
          {guestNote && (
            <p className="text-xs text-[#94a3b8] mt-0.5 italic">Huésped: {guestNote}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: `${statusColors[task.status]}22`,
                color:       statusColors[task.status],
              }}
            >
              {statusLabels[task.status]}
            </span>
            {task.assignee ? (
              <span className="text-[10px] text-[#64748b]">👤 {task.assignee.name}</span>
            ) : (
              <span className="text-[10px] text-[#f97316]">Sin asignar</span>
            )}
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={onAssign}
            className="flex-shrink-0 flex items-center gap-1 text-xs text-[#64748b]
                       hover:text-[#0f172a] transition-colors"
          >
            Asignar <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Iniciar — shows person picker first */}
      {task.status === 'pending' && !pickingPerson && (
        <button
          onClick={() => setPickingPerson(true)}
          disabled={isPending}
          className="mt-3 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#6366f1' }}
        >
          ▶ Iniciar
        </button>
      )}

      {/* Inline person selector */}
      {task.status === 'pending' && pickingPerson && (
        <div className="mt-3 space-y-1.5">
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
            onClick={() => setPickingPerson(false)}
            className="w-full text-xs text-[#94a3b8] py-1 hover:text-[#64748b] transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Completar */}
      {task.status === 'in_progress' && (
        <button
          onClick={complete}
          disabled={isPending}
          className="mt-3 w-full h-9 rounded-lg text-sm font-semibold text-white
                     active:opacity-80 transition-opacity disabled:opacity-50"
          style={{ background: '#22c55e' }}
        >
          {isPending ? '…' : '✓ Completar'}
        </button>
      )}
    </div>
  )
}

// ── Staff card ────────────────────────────────────────────────────────────────

function StaffCard({ member, isAdmin }: { member: TeamMember; isAdmin: boolean }) {
  const [isPending, startTransition] = useTransition()

  function handleDeactivate() {
    if (!confirm(`¿Desactivar a ${member.name}?`)) return
    startTransition(async () => { await deactivateTeamMember(member.id) })
  }

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-[#e0e7ff] flex items-center justify-center
                      text-[#6366f1] font-bold text-sm flex-shrink-0">
        {member.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[#0f172a] text-sm">{member.name}</p>
        <p className="text-xs text-[#94a3b8]">{member.email}</p>
      </div>
      {isAdmin && (
        <button
          onClick={handleDeactivate}
          disabled={isPending}
          className="text-xs text-[#ef4444] hover:underline disabled:opacity-50"
        >
          {isPending ? '…' : 'Desactivar'}
        </button>
      )}
    </div>
  )
}

// ── Assign sheet ──────────────────────────────────────────────────────────────

function AssignSheet({
  task, staff, onClose,
}: {
  task: CleaningTask
  staff: TeamMember[]
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function select(memberId: string | null) {
    startTransition(async () => {
      await assignTask(task.id, memberId)
    })
    onClose()
  }

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle>Asignar limpieza — {task.property?.name ?? ''}</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 pb-6">
          {staff.map(m => (
            <button
              key={m.id}
              onClick={() => select(m.id)}
              disabled={isPending}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors
                          ${task.assigned_to === m.id
                            ? 'border-[#6366f1] bg-[#e0e7ff]'
                            : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}
            >
              <div className="w-9 h-9 rounded-full bg-[#e0e7ff] flex items-center justify-center
                              text-[#6366f1] font-bold text-sm flex-shrink-0">
                {m.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-[#0f172a]">{m.name}</span>
              {task.assigned_to === m.id && (
                <span className="ml-auto text-[#6366f1] text-xs font-semibold">✓ Asignado</span>
              )}
            </button>
          ))}
          {task.assigned_to && (
            <button
              onClick={() => select(null)}
              disabled={isPending}
              className="w-full p-3 rounded-xl border border-[#e2e8f0] text-sm text-[#ef4444]
                         hover:bg-[#fef2f2] transition-colors"
            >
              Quitar asignación
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Add staff sheet ───────────────────────────────────────────────────────────

function AddStaffSheet({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [tempPassword, setTempPassword] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createTeamMember(formData)
      if (!result.success) { setError(result.error ?? 'Error'); return }
      onClose()
    })
  }

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle>Agregar persona de limpieza</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <input type="hidden" name="role" value="cleaning" />

          <div>
            <Label>Nombre completo *</Label>
            <Input name="name" placeholder="Ana Martínez" className="mt-1" required />
          </div>
          <div>
            <Label>Correo electrónico *</Label>
            <Input name="email" type="email" placeholder="ana@ejemplo.com" className="mt-1" required />
          </div>
          <div>
            <Label>Contraseña temporal *</Label>
            <Input
              name="password"
              type="text"
              placeholder="La persona la cambiará al ingresar"
              className="mt-1"
              value={tempPassword}
              onChange={e => setTempPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => {
                const p = `Limpieza${Math.floor(Math.random() * 9000) + 1000}!`
                setTempPassword(p)
              }}
              className="text-xs text-[#6366f1] mt-1 hover:underline"
            >
              Generar contraseña automática
            </button>
          </div>

          {error && <p className="text-sm text-[#ef4444]">{error}</p>}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-12"
            style={{ background: '#6366f1' }}
          >
            {isPending ? 'Creando cuenta…' : 'Crear persona de limpieza'}
          </Button>
          <p className="text-xs text-[#94a3b8] text-center">
            La persona recibirá acceso con ese correo y contraseña.
            Podrá ver tareas, propiedades e inventario, pero no montos financieros.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  )
}
