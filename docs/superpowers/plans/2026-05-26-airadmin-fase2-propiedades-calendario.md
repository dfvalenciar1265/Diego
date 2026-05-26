# AirAdmin — Fase 2: Propiedades y Calendario de Reservas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisito:** Fase 1 completada (auth funcionando, DB lista, shell con BottomNav)

**Goal:** CRUD de apartamentos con ficha completa, y calendario de reservas con grilla mensual y formulario de reserva/bloqueo.

**Architecture:** Server Components para fetch inicial de datos, Client Components para interacciones (formularios, selección de fechas). Server Actions para mutaciones.

**Tech Stack:** Next.js 15 App Router, Supabase, Tailwind, shadcn/ui Sheet para formularios

---

## Estructura de Archivos (Fase 2)

```
app/(app)/
├── properties/
│   ├── page.tsx                     # Lista de propiedades
│   └── [id]/
│       └── page.tsx                 # Detalle + stock de insumos
├── calendar/
│   └── page.tsx                     # Calendario de reservas
components/
├── properties/
│   ├── PropertyCard.tsx             # Tarjeta de propiedad en lista
│   └── PropertyForm.tsx             # Sheet form: crear/editar propiedad
├── calendar/
│   ├── ReservationGrid.tsx          # Grilla propiedades × días
│   ├── ReservationBlock.tsx         # Bloque de color en la grilla
│   └── ReservationForm.tsx          # Sheet form: crear/editar reserva
actions/
├── properties.ts                    # Server actions CRUD propiedades
└── reservations.ts                  # Server actions CRUD reservas
__tests__/
├── actions/
│   └── reservations.test.ts
└── components/
    └── ReservationBlock.test.tsx
```

---

## Task 7: Módulo de Propiedades

**Files:**
- Create: `actions/properties.ts`
- Create: `components/properties/PropertyCard.tsx`
- Create: `components/properties/PropertyForm.tsx`
- Create: `app/(app)/properties/page.tsx`
- Create: `app/(app)/properties/[id]/page.tsx`

- [ ] **Crear `actions/properties.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Property } from '@/lib/types'

export async function getProperties(): Promise<Property[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getProperty(id: string): Promise<Property | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()
  return data
}

export async function createProperty(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('properties').insert({
    name: formData.get('name') as string,
    address: formData.get('address') as string,
    access_code: formData.get('access_code') as string,
    instructions: formData.get('instructions') as string,
    capacity: Number(formData.get('capacity')) || 2,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  return { success: true }
}

export async function updateProperty(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('properties').update({
    name: formData.get('name') as string,
    address: formData.get('address') as string,
    access_code: formData.get('access_code') as string,
    instructions: formData.get('instructions') as string,
    capacity: Number(formData.get('capacity')) || 2,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/properties')
  revalidatePath(`/properties/${id}`)
  return { success: true }
}
```

- [ ] **Crear `components/properties/PropertyCard.tsx`**

```typescript
import type { Property } from '@/lib/types'
import Link from 'next/link'

interface Props {
  property: Property
}

export function PropertyCard({ property }: Props) {
  return (
    <Link href={`/properties/${property.id}`}>
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-4
                      shadow-[0_1px_3px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-transform">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#fff5f5] flex items-center
                          justify-center text-xl flex-shrink-0">
            🏠
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#0f172a] truncate">{property.name}</p>
            <p className="text-sm text-[#94a3b8] truncate">{property.address}</p>
          </div>
          <span className="text-[#94a3b8] text-lg">›</span>
        </div>
        {property.access_code && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-[#94a3b8]">Acceso:</span>
            <span className="text-xs font-mono bg-[#f8fafc] border border-[#e2e8f0]
                             rounded px-2 py-0.5 text-[#0f172a]">
              {property.access_code}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Crear `components/properties/PropertyForm.tsx`**

```typescript
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
  property?: Property        // si viene → modo edición
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
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
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
```

- [ ] **Crear `app/(app)/properties/page.tsx`**

```typescript
import { getProperties } from '@/actions/properties'
import { PropertyCard } from '@/components/properties/PropertyCard'
import { PageHeader } from '@/components/layout/PageHeader'
import { AddPropertyButton } from '@/components/properties/AddPropertyButton'

export default async function PropertiesPage() {
  const properties = await getProperties()

  return (
    <>
      <PageHeader title="Mis apartamentos" action={<AddPropertyButton />} />
      <div className="p-4 space-y-3">
        {properties.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🏠</p>
            <p className="text-[#94a3b8]">Aún no tienes apartamentos</p>
          </div>
        ) : (
          properties.map(p => <PropertyCard key={p.id} property={p} />)
        )}
      </div>
    </>
  )
}
```

- [ ] **Crear `components/properties/AddPropertyButton.tsx`** (Client Component para el Sheet)

```typescript
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PropertyForm } from './PropertyForm'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'

export function AddPropertyButton() {
  const [open, setOpen] = useState(false)
  const { member } = useCurrentUser()
  if (!member || !canDo(member.role, 'properties:edit')) return null
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}
              style={{ background: '#ff385c' }} className="text-white">
        + Nuevo
      </Button>
      <PropertyForm open={open} onClose={() => setOpen(false)} />
    </>
  )
}
```

- [ ] **Verificar en el navegador**

```bash
npm run dev
```
Ir a `/properties` → debe mostrar lista vacía con botón "+ Nuevo" → crear un apto → debe aparecer en la lista

- [ ] **Commit**

```bash
git add actions/properties.ts components/properties/ app/\(app\)/properties/
git commit -m "feat: add properties module with CRUD"
```

---

## Task 8: Calendario de Reservas

**Files:**
- Create: `actions/reservations.ts`
- Create: `components/calendar/ReservationGrid.tsx`
- Create: `components/calendar/ReservationBlock.tsx`
- Create: `components/calendar/ReservationForm.tsx`
- Create: `app/(app)/calendar/page.tsx`
- Create: `__tests__/actions/reservations.test.ts`

- [ ] **Escribir tests para lógica de reservas** — `__tests__/actions/reservations.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { getOccupiedDaysInWeek, reservationOverlapsDate } from '@/lib/utils'

describe('reservation utils', () => {
  it('counts occupied days in a week window', () => {
    const checkIn = '2026-05-26'
    const checkOut = '2026-05-30'
    const weekStart = '2026-05-25'
    const weekEnd = '2026-05-31'
    expect(getOccupiedDaysInWeek(checkIn, checkOut, weekStart, weekEnd)).toBe(4)
  })

  it('returns 0 if reservation is outside the week', () => {
    expect(getOccupiedDaysInWeek('2026-06-01', '2026-06-03', '2026-05-25', '2026-05-31')).toBe(0)
  })

  it('detects overlap with a given date', () => {
    expect(reservationOverlapsDate('2026-05-26', '2026-05-30', '2026-05-28')).toBe(true)
    expect(reservationOverlapsDate('2026-05-26', '2026-05-30', '2026-05-30')).toBe(false) // check-out no cuenta
    expect(reservationOverlapsDate('2026-05-26', '2026-05-30', '2026-05-25')).toBe(false)
  })
})
```

- [ ] **Ejecutar — debe fallar**

```bash
npx vitest run __tests__/actions/reservations.test.ts
```

- [ ] **Agregar utils a `lib/utils.ts`**

```typescript
import { parseISO, differenceInDays, isWithinInterval, startOfDay } from 'date-fns'

export function getOccupiedDaysInWeek(
  checkIn: string, checkOut: string,
  weekStart: string, weekEnd: string
): number {
  const ci = parseISO(checkIn)
  const co = parseISO(checkOut)
  const ws = parseISO(weekStart)
  const we = parseISO(weekEnd)
  const start = ci < ws ? ws : ci
  const end = co < we ? co : we
  return Math.max(0, differenceInDays(end, start))
}

export function reservationOverlapsDate(
  checkIn: string, checkOut: string, date: string
): boolean {
  const d = parseISO(date)
  return d >= parseISO(checkIn) && d < parseISO(checkOut)
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP',
    maximumFractionDigits: 0 }).format(amount)
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
    .format(parseISO(date))
}
```

- [ ] **Ejecutar tests — deben pasar**

```bash
npx vitest run __tests__/actions/reservations.test.ts
```
Esperado: ✅ PASS

- [ ] **Crear `actions/reservations.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Reservation } from '@/lib/types'

export async function getReservations(month?: string): Promise<Reservation[]> {
  const supabase = await createClient()
  let query = supabase.from('reservations').select('*').order('check_in')
  if (month) {
    // month formato: 'YYYY-MM'
    query = query
      .gte('check_in', `${month}-01`)
      .lt('check_in', `${month}-32`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createReservation(
  formData: FormData
): Promise<{ success: boolean; error?: string; reservation?: Reservation }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('reservations').insert({
    property_id: formData.get('property_id') as string,
    source: formData.get('source') as string,
    guest_name: formData.get('guest_name') as string,
    check_in: formData.get('check_in') as string,
    check_out: formData.get('check_out') as string,
    amount: Number(formData.get('amount')) || 0,
    notes: formData.get('notes') as string,
    status: 'confirmed',
  }).select().single()
  if (error) return { success: false, error: error.message }
  revalidatePath('/calendar')
  revalidatePath('/')
  return { success: true, reservation: data }
}

export async function updateReservation(
  id: string, formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('reservations').update({
    guest_name: formData.get('guest_name') as string,
    check_in: formData.get('check_in') as string,
    check_out: formData.get('check_out') as string,
    amount: Number(formData.get('amount')) || 0,
    notes: formData.get('notes') as string,
    source: formData.get('source') as string,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/calendar')
  revalidatePath('/')
  return { success: true }
}

export async function deleteReservation(id: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('reservations').delete().eq('id', id)
  revalidatePath('/calendar')
  revalidatePath('/')
}
```

- [ ] **Crear `components/calendar/ReservationBlock.tsx`**

```typescript
import type { Reservation } from '@/lib/types'

interface Props {
  reservation: Reservation
  onClick: (r: Reservation) => void
  style?: React.CSSProperties
}

const SOURCE_COLORS = {
  airbnb: { bg: '#ff385c', text: 'white' },
  direct: { bg: '#6366f1', text: 'white' },
  blocked: { bg: '#94a3b8', text: 'white' },
}

export function ReservationBlock({ reservation, onClick, style }: Props) {
  const colors = SOURCE_COLORS[reservation.source] ?? SOURCE_COLORS.direct

  return (
    <button
      onClick={() => onClick(reservation)}
      className="absolute top-1 bottom-1 rounded text-xs font-medium px-1
                 overflow-hidden text-left active:opacity-80 transition-opacity"
      style={{ backgroundColor: colors.bg, color: colors.text, ...style }}>
      <span className="truncate block">
        {reservation.status === 'blocked' ? '🚫 Bloqueado' : reservation.guest_name}
      </span>
    </button>
  )
}
```

- [ ] **Crear `app/(app)/calendar/page.tsx`**

```typescript
import { getProperties } from '@/actions/properties'
import { getReservations } from '@/actions/reservations'
import { CalendarView } from '@/components/calendar/CalendarView'
import { PageHeader } from '@/components/layout/PageHeader'

export default async function CalendarPage() {
  const [properties, reservations] = await Promise.all([
    getProperties(),
    getReservations(),
  ])

  return (
    <>
      <PageHeader title="Calendario de reservas" />
      <CalendarView properties={properties} reservations={reservations} />
    </>
  )
}
```

- [ ] **Crear `components/calendar/CalendarView.tsx`** (Client Component con estado de mes)

```typescript
'use client'
import { useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, parseISO, addMonths, subMonths
} from 'date-fns'
import { es } from 'date-fns/locale'
import type { Property, Reservation } from '@/lib/types'
import { reservationOverlapsDate } from '@/lib/utils'
import { ReservationForm } from './ReservationForm'

interface Props {
  properties: Property[]
  reservations: Reservation[]
}

export function CalendarView({ properties, reservations }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('')

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })

  function getReservationForDay(propertyId: string, date: Date): Reservation | null {
    const dateStr = format(date, 'yyyy-MM-dd')
    return reservations.find(r =>
      r.property_id === propertyId &&
      reservationOverlapsDate(r.check_in, r.check_out, dateStr)
    ) ?? null
  }

  return (
    <div className="overflow-x-auto pb-4">
      {/* Header mes */}
      <div className="flex items-center justify-between px-4 py-3 sticky left-0 bg-[#f8fafc]">
        <button onClick={() => setCurrentMonth(m => subMonths(m, 1))}
                className="w-10 h-10 flex items-center justify-center text-[#94a3b8]">‹</button>
        <span className="font-semibold text-[#0f172a] capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </span>
        <button onClick={() => setCurrentMonth(m => addMonths(m, 1))}
                className="w-10 h-10 flex items-center justify-center text-[#94a3b8]">›</button>
      </div>

      {/* Grilla */}
      <div style={{ minWidth: `${Math.max(600, days.length * 36 + 80)}px` }}>
        {/* Header días */}
        <div className="flex" style={{ marginLeft: 80 }}>
          {days.map(day => (
            <div key={day.toISOString()}
                 className="w-9 flex-shrink-0 text-center text-[10px] text-[#94a3b8] py-1">
              {format(day, 'd')}
            </div>
          ))}
        </div>

        {/* Filas por propiedad */}
        {properties.map(property => (
          <div key={property.id} className="flex items-center border-t border-[#f1f5f9]">
            <div className="w-20 flex-shrink-0 px-2 py-2">
              <p className="text-xs font-medium text-[#0f172a] truncate">{property.name}</p>
            </div>
            {days.map(day => {
              const res = getReservationForDay(property.id, day)
              const dateStr = format(day, 'yyyy-MM-dd')
              const isCheckIn = res?.check_in === dateStr
              const isCheckOut = res?.check_out === format(
                new Date(day.getTime() + 86400000), 'yyyy-MM-dd'
              )

              return (
                <div key={day.toISOString()}
                     className="w-9 flex-shrink-0 h-9 relative border-l border-[#f1f5f9]"
                     onClick={() => {
                       if (!res) {
                         setSelectedPropertyId(property.id)
                         setFormOpen(true)
                       } else {
                         setSelectedReservation(res)
                         setFormOpen(true)
                       }
                     }}>
                  {res && (
                    <div className="absolute inset-1 rounded text-[9px] flex items-center
                                    justify-center font-medium"
                         style={{
                           backgroundColor: res.source === 'airbnb' ? '#ff385c' : '#6366f1',
                           color: 'white',
                           borderRadius: isCheckIn ? '4px 0 0 4px' : isCheckOut ? '0 4px 4px 0' : '0',
                         }}>
                      {isCheckIn ? '→' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Leyenda */}
      <div className="flex gap-4 px-4 pt-3">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#ff385c]" />
          <span className="text-xs text-[#94a3b8]">Airbnb</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#6366f1]" />
          <span className="text-xs text-[#94a3b8]">Directa</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-[#94a3b8]" />
          <span className="text-xs text-[#94a3b8]">Bloqueado</span>
        </div>
      </div>

      <ReservationForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setSelectedReservation(null) }}
        reservation={selectedReservation ?? undefined}
        propertyId={selectedPropertyId}
        properties={properties}
      />
    </div>
  )
}
```

- [ ] **Crear `components/calendar/ReservationForm.tsx`**

```typescript
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
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
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
```

- [ ] **Verificar en el navegador**

```bash
npm run dev
```
- Ir a `/calendar` → debe mostrar grilla con los apartamentos
- Tocar una celda vacía → debe abrir formulario de nueva reserva
- Crear una reserva → debe aparecer como bloque de color en la grilla

- [ ] **Commit**

```bash
git add actions/reservations.ts lib/utils.ts components/calendar/ app/\(app\)/calendar/
git commit -m "feat: add reservations calendar with monthly grid view"
```

---

## ✅ Fase 2 Completada

Al finalizar esta fase tendrás:
- CRUD completo de apartamentos con ficha de acceso e instrucciones
- Calendario mensual con grilla de ocupación por apartamento
- Formulario para crear/editar/eliminar reservas (Airbnb y directas)
- Tests para lógica de fechas pasando

**Siguiente:** [Fase 3 — Tareas y Mantenimiento](./2026-05-26-airadmin-fase3-tareas-mantenimiento.md)
