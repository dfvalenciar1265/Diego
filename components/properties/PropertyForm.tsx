'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createProperty, updateProperty } from '@/actions/properties'
import type { Property } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  property?: Property
}

export function PropertyForm({ open, onClose, property }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError('')

    startTransition(async () => {
      const result = property
        ? await updateProperty(property.id, formData)
        : await createProperty(formData)

      if (!result.success) {
        setError(result.error ?? 'Error al guardar')
        return
      }
      onClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()} key={property?.id ?? 'new'}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{property ? 'Editar apartamento' : 'Nuevo apartamento'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div>
            <Label htmlFor="name">Nombre *</Label>
            <Input id="name" name="name" defaultValue={property?.name}
                   placeholder="Ej: Apto 1A — Torre Norte" required className="mt-1" />
          </div>
          <div>
            <Label htmlFor="address">Dirección</Label>
            <Input id="address" name="address" defaultValue={property?.address}
                   placeholder="Calle 123 # 45-67, Piso 8" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="access_code">Código de acceso</Label>
            <Input id="access_code" name="access_code" defaultValue={property?.access_code}
                   placeholder="PIN: 1234 / Caja fuerte: 5678" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="capacity">Capacidad (personas)</Label>
            <Input id="capacity" name="capacity" type="number" min={1} max={20}
                   defaultValue={property?.capacity ?? 2} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="instructions">Instrucciones para el equipo</Label>
            <textarea id="instructions" name="instructions"
                      defaultValue={property?.instructions}
                      placeholder="WiFi: RedNombre / Pass: contraseña. No usar ascensor..."
                      className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                                 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[#ff385c]" />
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Guardando...' : property ? 'Guardar cambios' : 'Crear apartamento'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
