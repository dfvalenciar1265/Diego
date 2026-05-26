'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createReservation, updateReservation, deleteReservation } from '@/actions/reservations'
import type { Property, Reservation } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  reservation?: Reservation
  propertyId?: string
  properties: Property[]
}

export function ReservationForm({ open, onClose, reservation, propertyId, properties }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      const result = reservation
        ? await updateReservation(reservation.id, formData)
        : await createReservation(formData)
      if (!result.success) { setError(result.error ?? 'Error'); return }
      onClose()
    })
  }

  async function handleDelete() {
    if (!reservation || !confirm('¿Eliminar esta reserva?')) return
    startTransition(async () => {
      await deleteReservation(reservation.id)
      onClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()} key={reservation?.id ?? 'new'}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{reservation ? 'Editar reserva' : 'Nueva reserva'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div>
            <Label>Apartamento *</Label>
            <select name="property_id"
                    defaultValue={reservation?.property_id ?? propertyId}
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]" required>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Tipo</Label>
            <select name="source" defaultValue={reservation?.source ?? 'airbnb'}
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                               focus:outline-none focus:ring-2 focus:ring-[#ff385c]">
              <option value="airbnb">Airbnb</option>
              <option value="direct">Reserva directa</option>
            </select>
          </div>
          <div>
            <Label>Nombre del huésped</Label>
            <Input name="guest_name" defaultValue={reservation?.guest_name}
                   placeholder="María García" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Check-in *</Label>
              <Input name="check_in" type="date" required
                     defaultValue={reservation?.check_in} className="mt-1" />
            </div>
            <div>
              <Label>Check-out *</Label>
              <Input name="check_out" type="date" required
                     defaultValue={reservation?.check_out} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Monto (COP)</Label>
            <Input name="amount" type="number" min={0}
                   defaultValue={reservation?.amount ?? 0} className="mt-1" />
          </div>
          <div>
            <Label>Notas</Label>
            <Input name="notes" defaultValue={reservation?.notes}
                   placeholder="Llegada tardía, mascota, etc." className="mt-1" />
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Guardando...' : reservation ? 'Guardar cambios' : 'Crear reserva'}
          </Button>
          {reservation && (
            <Button type="button" variant="outline" onClick={handleDelete}
                    disabled={isPending} className="w-full h-10 text-[#ef4444] border-[#ef4444]">
              Eliminar reserva
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}
