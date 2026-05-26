'use client'
import { useState, useTransition, useRef } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createMaintenanceIssue, uploadMaintenancePhoto } from '@/actions/maintenance'
import type { Property } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  properties: Property[]
}

export function IncidenceForm({ open, onClose, properties }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  function handleClose() {
    setPhotoPreview(null)
    if (fileRef.current) fileRef.current.value = ''
    setError('')
    onClose()
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const file = fileRef.current?.files?.[0]
    setError('')

    startTransition(async () => {
      let photoUrl: string | undefined
      if (file) {
        const url = await uploadMaintenancePhoto(file)
        if (url) photoUrl = url
      }
      const result = await createMaintenanceIssue(formData, photoUrl)
      if (!result.success) { setError(result.error ?? 'Error'); return }
      handleClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && handleClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Reportar incidencia</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div>
            <Label>Apartamento *</Label>
            <select name="property_id" defaultValue=""
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]" required>
              <option value="" disabled>Seleccionar apartamento</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Título *</Label>
            <Input name="title" placeholder="Ej: AC no enfría" required className="mt-1" />
          </div>
          <div>
            <Label>Prioridad</Label>
            <div className="flex gap-2 mt-1">
              {(['urgent', 'normal', 'scheduled'] as const).map(p => (
                <label key={p} className="flex-1">
                  <input type="radio" name="priority" value={p}
                         defaultChecked={p === 'normal'} className="sr-only peer" />
                  <div className="text-center py-2 px-1 rounded-lg border border-[#e2e8f0] text-xs
                                  font-medium cursor-pointer peer-checked:border-[#ff385c]
                                  peer-checked:bg-[#fff5f5] peer-checked:text-[#ff385c]
                                  text-[#94a3b8] transition-colors">
                    {p === 'urgent' ? '🔴 Urgente' : p === 'normal' ? '🟡 Normal' : '🔵 Program.'}
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <textarea name="description"
                      placeholder="Describe el problema con detalle..."
                      className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                                 min-h-[70px] focus:outline-none focus:ring-2 focus:ring-[#ff385c]" />
          </div>
          <div>
            <Label>Foto (opcional)</Label>
            <div className="mt-1">
              {photoPreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoPreview} alt="Vista previa"
                       className="w-full h-40 object-cover rounded-xl border border-[#e2e8f0]" />
                  <button type="button"
                          onClick={() => { setPhotoPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                          className="absolute top-2 right-2 bg-white rounded-full w-7 h-7 text-sm border border-[#e2e8f0]"
                          aria-label="Eliminar foto">
                    ✕
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                        className="w-full h-24 rounded-xl border-2 border-dashed border-[#e2e8f0]
                                   flex flex-col items-center justify-center gap-1 text-[#94a3b8]">
                  <span className="text-2xl">📷</span>
                  <span className="text-xs">Toca para agregar foto</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment"
                     onChange={handlePhotoChange} className="hidden" />
            </div>
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Enviando...' : 'Reportar incidencia'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
