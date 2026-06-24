'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTask, updateTask } from '@/actions/tasks'
import type { Property, TeamMember, Task } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  properties: Property[]
  teamMembers: TeamMember[]
  defaultPropertyId?: string
  defaultDate?: string
  task?: Task   // when present → edit mode
}

export function TaskForm({ open, onClose, properties, teamMembers, defaultPropertyId, defaultDate, task }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const isEdit = !!task

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      const result = task ? await updateTask(task.id, formData) : await createTask(formData)
      if (!result.success) { setError(result.error ?? 'Error'); return }
      onClose()
    })
  }

  const cleaners = teamMembers.filter(m => m.role === 'cleaning' || m.role === 'admin')

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()} key={task?.id ?? 'new'}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{isEdit ? 'Editar tarea' : 'Nueva tarea'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div>
            <Label>Apartamento *</Label>
            <select name="property_id" defaultValue={task?.property_id ?? defaultPropertyId ?? ''}
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]" required>
              <option value="" disabled>Seleccionar apartamento</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {/* Type is fixed to 'other' on the tasks page */}
          <input type="hidden" name="type" value="other" />
          <div>
            <Label>Asignar a</Label>
            <select name="assigned_to" defaultValue={task?.assigned_to ?? ''}
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]">
              <option value="">Sin asignar</option>
              {cleaners.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Fecha programada *</Label>
            <Input name="scheduled_for" type="date" required
                   defaultValue={task?.scheduled_for ?? defaultDate ?? new Date().toISOString().split('T')[0]}
                   className="mt-1" />
          </div>
          <div>
            <Label>Descripción</Label>
            <Input name="notes" defaultValue={task?.notes ?? ''} placeholder="¿Qué hay que hacer?" className="mt-1" />
          </div>
          <div>
            <Label>Costo ($) <span className="text-[#94a3b8] font-normal">— opcional</span></Label>
            <Input name="cost" type="number" min="0" step="0.01"
                   defaultValue={task?.cost ?? ''} placeholder="Opcional (déjalo vacío si no aplica)"
                   className="mt-1" />
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
