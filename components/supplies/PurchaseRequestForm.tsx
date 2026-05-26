'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createPurchaseRequest } from '@/actions/purchases'
import type { Property, Supply } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  properties: Property[]
  supplies: Supply[]
  defaultPropertyId?: string
}

export function PurchaseRequestForm({ open, onClose, properties, supplies, defaultPropertyId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      const result = await createPurchaseRequest(formData)
      if (!result.success) { setError(result.error ?? 'Error'); return }
      onClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle>Solicitar compra</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div>
            <Label>Apartamento *</Label>
            <select name="property_id" defaultValue={defaultPropertyId ?? ''}
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]" required>
              <option value="" disabled>Seleccionar apartamento</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Insumo (opcional)</Label>
            <select name="supply_id"
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]">
              <option value="">Seleccionar insumo...</option>
              {supplies.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Descripción *</Label>
            <Input name="description" required
                   placeholder="Ej: Falta desinfectante, quedan 0 unidades" className="mt-1" />
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Enviando...' : 'Enviar solicitud'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
