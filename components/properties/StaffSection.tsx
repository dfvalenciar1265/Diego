'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTeamMember, deactivateTeamMember } from '@/actions/team'
import { useUserRole } from '@/lib/user-context'
import type { TeamMember, UserRole } from '@/lib/types'
import { UserPlus } from 'lucide-react'

interface Props {
  staff: TeamMember[]
}

const ROLE_GROUPS: { role: UserRole; label: string; emoji: string; accent: string; bg: string }[] = [
  { role: 'admin',      label: 'Administradores', emoji: '👑', accent: '#6366f1', bg: '#e0e7ff' },
  { role: 'cleaning',   label: 'Personal de limpieza', emoji: '🧹', accent: '#0ea5e9', bg: '#e0f2fe' },
  { role: 'anfitrion',  label: 'Anfitriones',     emoji: '🏠', accent: '#f59e0b', bg: '#fef3c7' },
  { role: 'maintenance',label: 'Mantenimiento',   emoji: '🔧', accent: '#ef4444', bg: '#fee2e2' },
]

export function StaffSection({ staff }: Props) {
  const [addOpen, setAddOpen]     = useState(false)
  const [addRole, setAddRole]     = useState<UserRole>('cleaning')
  const role    = useUserRole()
  const isAdmin = role === 'admin'

  const nonAdminGroups = ROLE_GROUPS.filter(g => g.role !== 'admin')
  const adminGroup     = ROLE_GROUPS.find(g => g.role === 'admin')!

  const adminStaff = staff.filter(m => m.role === 'admin')

  function openAdd(r: UserRole) {
    setAddRole(r)
    setAddOpen(true)
  }

  return (
    <div className="space-y-3">

      {/* Admins */}
      {adminStaff.length > 0 && (
        <StaffGroup
          label={adminGroup.label}
          emoji={adminGroup.emoji}
          accent={adminGroup.accent}
          bg={adminGroup.bg}
          members={adminStaff}
          isAdmin={isAdmin}
          onAdd={isAdmin ? () => openAdd('admin') : undefined}
        />
      )}

      {/* Other groups */}
      {nonAdminGroups.map(g => {
        const members = staff.filter(m => m.role === g.role)
        return (
          <StaffGroup
            key={g.role}
            label={g.label}
            emoji={g.emoji}
            accent={g.accent}
            bg={g.bg}
            members={members}
            isAdmin={isAdmin}
            onAdd={isAdmin ? () => openAdd(g.role) : undefined}
          />
        )
      })}

      {addOpen && (
        <AddStaffSheet
          role={addRole}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}

// ── Staff group ───────────────────────────────────────────────────────────────

function StaffGroup({
  label, emoji, accent, bg, members, isAdmin, onAdd,
}: {
  label: string; emoji: string; accent: string; bg: string
  members: TeamMember[]; isAdmin: boolean; onAdd?: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4
                    shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{emoji}</span>
          <h2 className="font-semibold text-[#0f172a] text-sm">{label}</h2>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: bg, color: accent }}
          >
            {members.length}
          </span>
        </div>
        {isAdmin && onAdd && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity"
            style={{ color: accent }}
          >
            <UserPlus size={14} />
            Agregar
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-[#94a3b8] text-center py-2">
          No hay nadie registrado
        </p>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <StaffCard key={m.id} member={m} isAdmin={isAdmin} accent={accent} bg={bg} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Staff card ────────────────────────────────────────────────────────────────

function StaffCard({
  member, isAdmin, accent, bg,
}: { member: TeamMember; isAdmin: boolean; accent: string; bg: string }) {
  const [isPending, startTransition] = useTransition()

  function handleDeactivate() {
    if (!confirm(`¿Desactivar a ${member.name}?`)) return
    startTransition(async () => { await deactivateTeamMember(member.id) })
  }

  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#f1f5f9] last:border-0">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center
                   font-bold text-sm flex-shrink-0"
        style={{ background: bg, color: accent }}
      >
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
          className="text-xs text-[#ef4444] hover:underline disabled:opacity-50 flex-shrink-0"
        >
          {isPending ? '…' : 'Desactivar'}
        </button>
      )}
    </div>
  )
}

// ── Add staff sheet ───────────────────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  admin:       'administrador',
  cleaning:    'persona de limpieza',
  anfitrion:   'anfitrión',
  maintenance: 'persona de mantenimiento',
}

function AddStaffSheet({ role, onClose }: { role: UserRole; onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState('')
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
          <SheetTitle>Agregar {ROLE_LABEL[role]}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <input type="hidden" name="role" value={role} />

          <div>
            <Label>Nombre completo *</Label>
            <Input name="name" placeholder="Ana Martínez" className="mt-1" required />
          </div>
          <div>
            <Label>Correo electrónico *</Label>
            <Input name="email" type="email" placeholder="ana@ejemplo.com" className="mt-1" required />
          </div>
          <div>
            <Label>Contraseña *</Label>
            <Input
              name="password"
              type="text"
              placeholder="La persona la usará para entrar"
              className="mt-1"
              value={tempPassword}
              onChange={e => setTempPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setTempPassword(`${role.charAt(0).toUpperCase() + role.slice(1)}${Math.floor(Math.random() * 9000) + 1000}`)}
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
            {isPending ? 'Creando cuenta…' : `Crear ${ROLE_LABEL[role]}`}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
