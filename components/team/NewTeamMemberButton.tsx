'use client'
import { useState, useTransition } from 'react'
import { createTeamMember } from '@/actions/team'

export function NewTeamMemberButton() {
  const [open, setOpen]         = useState(false)
  const [isPending, startTrans] = useTransition()
  const [error, setError]       = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTrans(async () => {
      const res = await createTeamMember(fd)
      if (!res.success) { setError(res.error ?? 'Error'); return }
      setOpen(false)
      ;(e.target as HTMLFormElement).reset()
    })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ background: '#6366f1' }}>
        + Persona
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit}
          className="fixed inset-0 z-50 flex items-end bg-black/40 p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="w-full bg-white rounded-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-[#0f172a]">Nueva persona</p>

        <div>
          <label className="text-xs text-[#64748b] font-medium">Nombre *</label>
          <input name="name" required placeholder="María García"
                 className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                            focus:outline-none focus:ring-1 focus:ring-[#6366f1]" />
        </div>
        <div>
          <label className="text-xs text-[#64748b] font-medium">Email *</label>
          <input name="email" type="email" required placeholder="maria@ejemplo.com"
                 className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                            focus:outline-none focus:ring-1 focus:ring-[#6366f1]" />
        </div>
        <div>
          <label className="text-xs text-[#64748b] font-medium">Rol</label>
          <select name="role" defaultValue="cleaning"
                  className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                             focus:outline-none focus:ring-1 focus:ring-[#6366f1]">
            <option value="admin">Administrador</option>
            <option value="cleaning">Limpieza</option>
            <option value="maintenance">Mantenimiento</option>
            <option value="anfitrion">Anfitrión</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#64748b] font-medium">Contraseña temporal</label>
          <input name="password" type="password" placeholder="(auto-generada si se deja vacío)"
                 className="w-full mt-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm
                            focus:outline-none focus:ring-1 focus:ring-[#6366f1]" />
        </div>

        {error && <p className="text-xs text-[#ef4444]">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={() => { setOpen(false); setError('') }}
                  className="flex-1 h-10 rounded-lg text-sm border border-[#e2e8f0] text-[#64748b]">
            Cancelar
          </button>
          <button type="submit" disabled={isPending}
                  className="flex-1 h-10 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: '#6366f1' }}>
            {isPending ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </form>
  )
}
