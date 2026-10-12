'use client'
import { useState, useTransition, useRef } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createMaintenanceIssue } from '@/actions/maintenance'
import { uploadMaintenancePhoto } from '@/lib/upload'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { toast } from '@/components/ui/feedback'
import type { MaintenancePriority, Property } from '@/lib/types'

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  urgent: '🔴 Urgente', normal: '🟡 Normal', scheduled: '🔵 Programado',
}
const REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: '',   label: 'Sin repetir' },
  { value: '1',  label: '1 mes' },
  { value: '2',  label: '2 meses' },
  { value: '3',  label: '3 meses' },
  { value: '6',  label: '6 meses' },
  { value: '12', label: '12 meses (1 año)' },
]
const SELECT_CLS = `w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm bg-white
                    focus:outline-none focus:ring-2 focus:ring-[#ff385c]`

interface Props {
  open: boolean
  onClose: () => void
  properties: Property[]
}

export function IncidenceForm({ open, onClose, properties }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [priority, setPriority] = useState<MaintenancePriority>('normal')
  const isScheduled = priority === 'scheduled'
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
    setPriority('normal')
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
        if (!url) {
          setError('No se pudo subir la foto. Intenta de nuevo.')
          toast.error('No se pudo subir la foto')
          return
        }
        photoUrl = url
      }
      const result = await createMaintenanceIssue(formData, photoUrl)
      if (!result.success) {
        setError(result.error ?? 'Error')
        toast.error('No se pudo reportar. Revisa los datos y reintenta.')
        return
      }
      toast.success(isScheduled ? 'Preventivo programado' : 'Incidencia reportada')
      handleClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && handleClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{isScheduled ? 'Programar mantenimiento' : 'Reportar incidencia'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-6">
          <div>
            <Label>Apartamento *</Label>
            <select name="property_id" defaultValue="" className={SELECT_CLS} required>
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
                         checked={priority === p} onChange={() => setPriority(p)}
                         className="sr-only peer" />
                  <div className="text-center min-h-11 flex items-center justify-center px-1 rounded-lg
                                  border border-[#e2e8f0] text-xs font-medium cursor-pointer
                                  peer-checked:border-[#ff385c] peer-checked:bg-[#fff5f5]
                                  peer-checked:text-[#ff385c] peer-focus-visible:ring-2
                                  peer-focus-visible:ring-[#ff385c] text-[#64748b] transition-colors">
                    {PRIORITY_LABEL[p]}
                  </div>
                </label>
              ))}
            </div>
          </div>
          {isScheduled && (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#eef2ff] p-3">
              <div>
                <Label htmlFor="next_due">Próxima fecha *</Label>
                <Input id="next_due" name="next_due" type="date" required
                       defaultValue={todayInBogota()} className="mt-1 bg-white" />
              </div>
              <div>
                <Label htmlFor="interval_months">Repetir cada</Label>
                <select id="interval_months" name="interval_months" defaultValue="" className={SELECT_CLS}>
                  {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <p className="col-span-2 text-xs text-[#64748b]">
                Al marcarlo hecho, la próxima fecha avanza sola según la repetición.
              </p>
            </div>
          )}
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
                          className="absolute top-2 right-2 bg-white rounded-full w-11 h-11 text-sm border border-[#e2e8f0]"
                          aria-label="Eliminar foto">
                    ✕
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                        className="w-full h-24 rounded-xl border-2 border-dashed border-[#e2e8f0]
                                   flex flex-col items-center justify-center gap-1 text-[#64748b]">
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
            {isPending ? 'Enviando...' : isScheduled ? 'Programar mantenimiento' : 'Reportar incidencia'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
