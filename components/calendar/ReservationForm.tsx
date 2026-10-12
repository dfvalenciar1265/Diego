'use client'
import { useRef, useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createReservation, updateReservation, deleteReservation } from '@/actions/reservations'
import { toast, useConfirm } from '@/components/ui/feedback'
import { useUserRole } from '@/lib/user-context'
import type { Property, Reservation, ReservationSource } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  reservation?: Reservation
  propertyId?: string
  properties: Property[]
  /** Pre-selects the source dropdown when creating a new reservation */
  defaultSource?: ReservationSource
}

export function ReservationForm({
  open, onClose, reservation, propertyId, properties, defaultSource,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  // Focus the title on open instead of the first field — otherwise the apartment
  // <select> grabs focus and pops the native picker as soon as the sheet opens.
  const titleRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const role = useUserRole()
  const confirm = useConfirm()
  const canSeeFinances = role === 'admin' || role === 'maintenance'

  /** Shows the error inside the sheet (scrolled into view) and as a toast. */
  function fail(message: string) {
    setError(message)
    toast.error(message)
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError('')
    const checkIn  = String(formData.get('check_in') ?? '')
    const checkOut = String(formData.get('check_out') ?? '')
    if (checkIn && checkOut && checkOut <= checkIn) {
      fail('La fecha de check-out debe ser posterior a la de check-in (mínimo una noche).')
      return
    }
    const guest = String(formData.get('guest_name') ?? '').trim()
    startTransition(async () => {
      try {
        const result = reservation
          ? await updateReservation(reservation.id, formData)
          : await createReservation(formData)
        if (!result.success) { fail(result.error ?? 'No se pudo guardar la reserva.'); return }
        const who = guest ? ` de ${guest}` : ''
        toast.success(reservation ? `Reserva${who} actualizada` : `Reserva${who} creada`)
        if (result.warning) toast.warning(result.warning, { duration: 8000 })
        onClose()
      } catch {
        fail('No se pudo guardar la reserva. Revisa tu conexión y reintenta.')
      }
    })
  }

  async function handleDelete() {
    if (!reservation) return
    const guest = reservation.guest_name?.trim()
    const ok = await confirm({
      title: guest ? `¿Eliminar la reserva de ${guest}?` : '¿Eliminar esta reserva?',
      description: 'La reserva queda cancelada y se borran su limpieza y su preparación.',
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const result = await deleteReservation(reservation.id)
        if (!result.success) { fail(result.error ?? 'No se pudo eliminar la reserva.'); return }
        toast.success(guest ? `Reserva de ${guest} eliminada` : 'Reserva eliminada')
        if (result.warning) toast.warning(result.warning, { duration: 8000 })
        onClose()
      } catch {
        fail('No se pudo eliminar la reserva. Revisa tu conexión y reintenta.')
      }
    })
  }

  const isNew    = !reservation
  const isAirbnb = (reservation?.source ?? defaultSource ?? 'direct') === 'airbnb'
  const title    = isNew
    ? (defaultSource === 'airbnb' ? 'Nueva reserva Airbnb' : 'Nueva reserva directa')
    : 'Editar reserva'

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) { setError(''); onClose() } }} key={reservation?.id ?? 'new'}>
      <SheetContent side="bottom" className="rounded-t-2xl" initialFocus={titleRef} style={{ maxHeight: '90dvh', overflowY: 'auto', padding: '1rem 1rem env(safe-area-inset-bottom,1rem)' }}>
        <SheetHeader className="mb-4">
          <div ref={titleRef} tabIndex={-1} className="outline-none">
            <SheetTitle>{title}</SheetTitle>
          </div>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pb-6">

          {/* Apartamento */}
          <div>
            <Label>Apartamento *</Label>
            <select
              name="property_id"
              defaultValue={reservation?.property_id ?? propertyId}
              className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
              required
            >
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Tipo (Airbnb / Directa) */}
          <div>
            <Label>Tipo</Label>
            <select
              name="source"
              defaultValue={reservation?.source ?? defaultSource ?? 'direct'}
              className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
            >
              <option value="direct">Reserva directa</option>
              <option value="airbnb">Airbnb</option>
            </select>
          </div>

          {/* Huésped + Número de huéspedes */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre del huésped</Label>
              <Input
                name="guest_name"
                defaultValue={reservation?.guest_name}
                placeholder="María García"
                className="mt-1"
              />
            </div>
            <div>
              <Label>N.° de huéspedes</Label>
              <Input
                name="guests"
                type="number"
                min={1}
                max={20}
                defaultValue={reservation?.guests ?? undefined}
                placeholder="2"
                className="mt-1"
              />
            </div>
          </div>

          {/* Fechas */}
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

          {/* Código Airbnb — visible cuando el tipo es airbnb */}
          {(reservation?.source === 'airbnb' || defaultSource === 'airbnb') && (
            <div>
              <Label>Código Airbnb</Label>
              <Input
                name="airbnb_code"
                defaultValue={reservation?.airbnb_code ?? undefined}
                placeholder="HM12345678"
                className="mt-1"
              />
              <p className="text-[11px] text-[#64748b] mt-1">
                Ponlo para que la reserva se cancele sola si cancelan en Airbnb.
              </p>
            </div>
          )}

          {/* Monto — solo visible para admin y mantenimiento */}
          {canSeeFinances && (
            <div>
              <Label>Monto (COP)</Label>
              <Input
                name="amount"
                type="number"
                min={0}
                defaultValue={reservation?.amount ?? 0}
                className="mt-1"
              />
            </div>
          )}

          {/* Notas */}
          <div>
            <Label>Notas</Label>
            <Input
              name="notes"
              defaultValue={reservation?.notes}
              placeholder="Llegada tardía, mascota, etc."
              className="mt-1"
            />
          </div>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-sm font-medium text-[#b91c1c]"
            >
              ⚠️ {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-12"
            style={{ background: isAirbnb ? '#ff385c' : '#6366f1' }}
          >
            {isPending ? 'Guardando...' : isNew ? 'Crear reserva' : 'Guardar cambios'}
          </Button>

          {reservation && role === 'admin' && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={isPending}
              className="w-full h-11 text-[#ef4444] border-[#ef4444]"
            >
              Eliminar reserva
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}
