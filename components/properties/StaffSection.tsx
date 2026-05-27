'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTeamMember, deactivateTeamMember } from '@/actions/team'
import { useUserRole } from '@/lib/user-context'
import type { TeamMember } from '@/lib/types'
import { UserPlus } from 'lucide-react'

interface Props {
  staff: TeamMember[]
}

export function StaffSection({ staff }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const role    = useUserRole()
  const isAdmin = role === 'admin'

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4
                    shadow-[0_1px_3px_rgba(0,0,0,0.06)]">

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-[#0f172a]">👥 Personal de limpieza</h2>
        {isAdmin && (
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#6366f1]
                       hover:opacity-80 transition-opacity"
          >
            <UserPlus size={14} />
            Agregar
          </button>
        )}
      </div>

      {staff.length === 0 ? (
        <p className="text-sm text-[#94a3b8] text-center py-4">
          No hay personal registrado
        </p>
      ) : (
        <div className="space-y-2">
          {staff.map(m => (
            <StaffCard key={m.id} member={m} isAdmin={isAdmin} />
          ))}
        </div>
      )}

      {addOpen && <AddStaffSheet onClose={() => setAddOpen(false)} />}
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
    <div className="flex items-center gap-3 py-2 border-b border-[#f1f5f9] last:border-0">
      <div className="w-9 h-9 rounded-full bg-[#e0e7ff] flex items-center justify-center
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
          className="text-xs text-[#ef4444] hover:underline disabled:opacity-50 flex-shrink-0"
        >
          {isPending ? '…' : 'Desactivar'}
        </button>
      )}
    </div>
  )
}

// ── Add staff sheet ───────────────────────────────────────────────────────────

function AddStaffSheet({ onClose }: { onClose: () => void }) {
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
              onClick={() => setTempPassword(`Limpieza${Math.floor(Math.random() * 9000) + 1000}!`)}
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
            La persona podrá ver tareas, propiedades e inventario,
            pero no montos financieros.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  )
}
