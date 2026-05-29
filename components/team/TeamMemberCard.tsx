'use client'
import { useState, useTransition } from 'react'
import { updateTeamMember, deactivateTeamMember } from '@/actions/team'
import type { TeamMember, UserRole } from '@/lib/types'

const ROLE_LABELS: Record<UserRole, string> = {
  admin:       'Administrador',
  cleaning:    'Limpieza',
  maintenance: 'Mantenimiento',
  anfitrion:   'Anfitrión',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:       '#6366f1',
  cleaning:    '#22c55e',
  maintenance: '#f97316',
  anfitrion:   '#ff385c',
}

interface Props {
  member: TeamMember
  isSelf: boolean   // can't deactivate yourself
}

export function TeamMemberCard({ member, isSelf }: Props) {
  const [editing, setEditing]     = useState(false)
  const [isPending, startTrans]   = useTransition()
  const [error, setError]         = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTrans(async () => {
      const res = await updateTeamMember(member.id, fd)
      if (!res.success) { setError(res.error ?? 'Error'); return }
      setEditing(false)
    })
  }

  function handleDeactivate() {
    if (!confirm(`¿Desactivar a ${member.name}? No podrá iniciar sesión.`)) return
    startTrans(async () => {
      await deactivateTeamMember(member.id)
    })
  }

  const color = ROLE_COLORS[member.role] ?? '#94a3b8'

  if (!editing) {
    return (
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 shadow-sm flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
             style={{ background: color }}>
          {member.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0f172a] truncate">{member.name}</p>
          <p className="text-xs text-[#94a3b8] truncate">{member.email}</p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1 inline-block"
                style={{ background: `${color}22`, color }}>
            {ROLE_LABELS[member.role] ?? member.role}
          </span>
        </div>

        <button
          onClick={() => setEditing(true)}
          className="text-xs text-[#6366f1] font-medium px-3 py-1.5 rounded-lg
                     bg-[#f0f0ff] active:opacity-70 flex-shrink-0"
        >
          Editar
        </button>
      </div>
    )
  }

  // Edit form
  return (
    <form onSubmit={handleSubmit}
          className="bg-white rounded-xl border border-[#6366f1] p-4 shadow-sm space-y-3">
      <p className="text-sm font-semibold text-[#0f172a]">Editar miembro</p>

      <div>
        <label className="text-xs text-[#64748b] font-medium">Nombre</label>
        <input name="name" required defaultValue={member.name}
               className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                          focus:outline-none focus:ring-1 focus:ring-[#6366f1]" />
      </div>

      <div>
        <label className="text-xs text-[#64748b] font-medium">Email</label>
        <input name="email" type="email" required defaultValue={member.email}
               className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                          focus:outline-none focus:ring-1 focus:ring-[#6366f1]" />
      </div>

      <div>
        <label className="text-xs text-[#64748b] font-medium">Rol</label>
        <select name="role" defaultValue={member.role}
                className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                           focus:outline-none focus:ring-1 focus:ring-[#6366f1]">
          <option value="admin">Administrador</option>
          <option value="cleaning">Limpieza</option>
          <option value="maintenance">Mantenimiento</option>
          <option value="anfitrion">Anfitrión</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-[#64748b] font-medium">Nueva contraseña <span className="text-[#94a3b8]">(dejar vacío para no cambiar)</span></label>
        <input name="password" type="password" placeholder="••••••••"
               className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                          focus:outline-none focus:ring-1 focus:ring-[#6366f1]" />
      </div>

      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => { setEditing(false); setError('') }}
                className="flex-1 h-9 rounded-lg text-sm border border-[#e2e8f0] text-[#64748b]">
          Cancelar
        </button>
        <button type="submit" disabled={isPending}
                className="flex-1 h-9 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#6366f1' }}>
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {!isSelf && (
        <button type="button" onClick={handleDeactivate} disabled={isPending}
                className="w-full text-xs text-[#ef4444] py-1 opacity-70 hover:opacity-100">
          Desactivar cuenta
        </button>
      )}
    </form>
  )
}
