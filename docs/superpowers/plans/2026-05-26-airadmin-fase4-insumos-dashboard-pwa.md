# AirAdmin — Fase 4: Insumos, Dashboard y PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisito:** Fases 1, 2 y 3 completadas.

**Goal:** Stock de insumos por apartamento con alertas, solicitudes de compra, dashboard KPIs completo, y configuración PWA para instalación en móvil.

**Architecture:** Dashboard como Server Component con múltiples queries paralelas. Stock con optimistic UI (+/− inmediato). PWA con manifest + service worker vía next-pwa.

**Tech Stack:** Next.js 15, Supabase, next-pwa, Tailwind

---

## Estructura de Archivos (Fase 4)

```
app/(app)/
├── page.tsx                         # Dashboard completo (reemplaza placeholder)
├── properties/[id]/
│   └── page.tsx                     # Detalle propiedad + stock
components/
├── dashboard/
│   ├── KPICard.tsx
│   ├── KPIRow.tsx
│   ├── OccupancyBar.tsx
│   └── StockAlert.tsx
├── supplies/
│   ├── StockItem.tsx
│   ├── StockList.tsx
│   └── PurchaseRequestForm.tsx
actions/
├── supplies.ts
├── purchases.ts
└── dashboard.ts
__tests__/
└── components/
    └── KPICard.test.tsx
public/
├── manifest.json
└── icons/
    ├── icon-192.png
    └── icon-512.png
next.config.ts                       # Actualizar con next-pwa
```

---

## Task 11: Insumos y Stock

**Files:**
- Create: `actions/supplies.ts`
- Create: `actions/purchases.ts`
- Create: `components/supplies/StockItem.tsx`
- Create: `components/supplies/StockList.tsx`
- Create: `components/supplies/PurchaseRequestForm.tsx`
- Create: `app/(app)/properties/[id]/page.tsx`

- [ ] **Crear `actions/supplies.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PropertySupply, Supply } from '@/lib/types'

export async function getPropertySupplies(propertyId: string): Promise<PropertySupply[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('property_supplies')
    .select('*, supply:supplies(*)')
    .eq('property_id', propertyId)
    .order('supply(name)')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getLowStockAlerts(): Promise<PropertySupply[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('property_supplies')
    .select('*, supply:supplies(*), property:properties(name)')
    .filter('current_qty', 'lte', 'min_qty')
  return data ?? []
}

export async function updateStock(
  id: string,
  delta: number               // +1 o -1
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Leer actual primero
  const { data: current } = await supabase
    .from('property_supplies').select('current_qty').eq('id', id).single()
  if (!current) return

  const newQty = Math.max(0, current.current_qty + delta)
  await supabase.from('property_supplies').update({
    current_qty: newQty,
    updated_by: user!.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  revalidatePath('/properties')
  revalidatePath('/')
}

export async function addSupplyToProperty(
  propertyId: string,
  supplyId: string,
  minQty: number
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('property_supplies').upsert({
    property_id: propertyId,
    supply_id: supplyId,
    current_qty: 0,
    min_qty: minQty,
  }, { onConflict: 'property_id,supply_id' })
  revalidatePath(`/properties/${propertyId}`)
}

export async function getAllSupplies(): Promise<Supply[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('supplies').select('*').order('name')
  return data ?? []
}

export async function createSupply(name: string, unit: string): Promise<Supply> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supplies').insert({ name, unit }).select().single()
  if (error) throw new Error(error.message)
  return data
}
```

- [ ] **Crear `actions/purchases.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { PurchaseRequest } from '@/lib/types'

export async function getPurchaseRequests(
  status?: 'pending' | 'purchased'
): Promise<PurchaseRequest[]> {
  const supabase = await createClient()
  let query = supabase
    .from('purchase_requests')
    .select('*, property:properties(name), supply:supplies(name, unit)')
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data } = await query
  return data ?? []
}

export async function createPurchaseRequest(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('purchase_requests').insert({
    property_id: formData.get('property_id') as string,
    supply_id: formData.get('supply_id') as string || null,
    description: formData.get('description') as string,
    requested_by: user!.id,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/')
  return { success: true }
}

export async function resolvePurchaseRequest(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('purchase_requests').update({
    status: 'purchased',
    resolved_by: user!.id,
  }).eq('id', id)
  revalidatePath('/')
}
```

- [ ] **Crear `components/supplies/StockItem.tsx`** (con optimistic UI)

```typescript
'use client'
import { useState, useTransition } from 'react'
import { updateStock } from '@/actions/supplies'
import type { PropertySupply } from '@/lib/types'

interface Props {
  item: PropertySupply & { supply?: { name: string; unit: string } }
}

export function StockItem({ item }: Props) {
  const [qty, setQty] = useState(item.current_qty)
  const [isPending, startTransition] = useTransition()
  const isLow = qty <= item.min_qty

  function changeQty(delta: number) {
    const newQty = Math.max(0, qty + delta)
    setQty(newQty)  // optimistic
    startTransition(() => updateStock(item.id, delta))
  }

  return (
    <div className={`flex items-center gap-3 py-3 border-b border-[#f1f5f9] last:border-0
                     ${isLow ? 'bg-[#fff5f5] -mx-4 px-4 rounded-lg' : ''}`}>
      <div className="flex-1">
        <p className="text-sm font-medium text-[#0f172a]">{item.supply?.name}</p>
        <p className="text-xs text-[#94a3b8]">
          Mínimo: {item.min_qty} {item.supply?.unit}
          {isLow && <span className="text-[#ef4444] font-semibold ml-2">⚠️ Stock bajo</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => changeQty(-1)} disabled={isPending || qty === 0}
                className="w-8 h-8 rounded-lg bg-[#f1f5f9] text-[#0f172a] font-bold
                           disabled:opacity-40 active:bg-[#e2e8f0]">
          −
        </button>
        <span className={`w-8 text-center text-sm font-bold
                          ${isLow ? 'text-[#ef4444]' : 'text-[#0f172a]'}`}>
          {qty}
        </span>
        <button onClick={() => changeQty(+1)} disabled={isPending}
                className="w-8 h-8 rounded-lg bg-[#f1f5f9] text-[#0f172a] font-bold
                           disabled:opacity-40 active:bg-[#e2e8f0]">
          +
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Crear `components/supplies/PurchaseRequestForm.tsx`**

```typescript
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await createPurchaseRequest(formData)
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
            <select name="property_id" defaultValue={defaultPropertyId}
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm" required>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Insumo (opcional)</Label>
            <select name="supply_id"
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm">
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
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Enviando...' : 'Enviar solicitud'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Crear `app/(app)/properties/[id]/page.tsx`**

```typescript
import { notFound } from 'next/navigation'
import { getProperty } from '@/actions/properties'
import { getPropertySupplies, getAllSupplies } from '@/actions/supplies'
import { getProperties } from '@/actions/properties'
import { PageHeader } from '@/components/layout/PageHeader'
import { StockItem } from '@/components/supplies/StockItem'
import { PropertyStockClient } from '@/components/supplies/PropertyStockClient'

interface Props { params: Promise<{ id: string }> }

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  const [property, stockItems, allSupplies, allProperties] = await Promise.all([
    getProperty(id),
    getPropertySupplies(id),
    getAllSupplies(),
    getProperties(),
  ])

  if (!property) notFound()

  return (
    <>
      <PageHeader title={property.name} backHref="/properties" />
      <div className="p-4 space-y-4">

        {/* Info del apto */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 space-y-3
                        shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {property.address && (
            <div>
              <p className="text-xs text-[#94a3b8]">Dirección</p>
              <p className="text-sm text-[#0f172a]">{property.address}</p>
            </div>
          )}
          {property.access_code && (
            <div>
              <p className="text-xs text-[#94a3b8]">Código de acceso</p>
              <code className="text-sm font-mono bg-[#f8fafc] border border-[#e2e8f0]
                               rounded px-3 py-1.5 block">{property.access_code}</code>
            </div>
          )}
          {property.instructions && (
            <div>
              <p className="text-xs text-[#94a3b8]">Instrucciones para el equipo</p>
              <p className="text-sm text-[#0f172a] whitespace-pre-wrap">{property.instructions}</p>
            </div>
          )}
        </div>

        {/* Stock de insumos */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-4
                        shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#0f172a]">📦 Insumos</h2>
            <PropertyStockClient
              propertyId={id}
              properties={allProperties}
              supplies={allSupplies}
            />
          </div>
          {stockItems.length === 0 ? (
            <p className="text-sm text-[#94a3b8] text-center py-4">
              Sin insumos registrados
            </p>
          ) : (
            stockItems.map(item => <StockItem key={item.id} item={item} />)
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Crear `components/supplies/PropertyStockClient.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PurchaseRequestForm } from './PurchaseRequestForm'
import type { Property, Supply } from '@/lib/types'

interface Props { propertyId: string; properties: Property[]; supplies: Supply[] }

export function PropertyStockClient({ propertyId, properties, supplies }: Props) {
  const [requestOpen, setRequestOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}
              className="text-xs border-[#ff385c] text-[#ff385c]">
        + Solicitar
      </Button>
      <PurchaseRequestForm
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        properties={properties}
        supplies={supplies}
        defaultPropertyId={propertyId}
      />
    </>
  )
}
```

- [ ] **Verificar stock en el navegador**

```bash
npm run dev
```
- Ir a `/properties` → tocar un apto → ver ficha con instrucciones
- Añadir insumo desde Supabase SQL: 
  ```sql
  insert into supplies (name, unit) values ('Papel higiénico', 'rollo'), ('Desinfectante', 'unidad');
  insert into property_supplies (property_id, supply_id, current_qty, min_qty)
  select p.id, s.id, 5, 3 from properties p, supplies s limit 4;
  ```
- Los insumos deben mostrarse con botones +/−
- Bajar a 0 → debe mostrar alerta roja "⚠️ Stock bajo"

- [ ] **Commit**

```bash
git add actions/supplies.ts actions/purchases.ts components/supplies/ app/\(app\)/properties/
git commit -m "feat: add supplies stock tracking with low-stock alerts and purchase requests"
```

---

## Task 12: Dashboard KPIs

**Files:**
- Create: `actions/dashboard.ts`
- Create: `components/dashboard/KPICard.tsx`
- Create: `components/dashboard/KPIRow.tsx`
- Create: `components/dashboard/OccupancyBar.tsx`
- Create: `components/dashboard/StockAlert.tsx`
- Modify: `app/(app)/page.tsx` (reemplazar placeholder)
- Create: `__tests__/components/KPICard.test.tsx`

- [ ] **Escribir test del KPICard** — `__tests__/components/KPICard.test.tsx`

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { KPICard } from '@/components/dashboard/KPICard'

describe('KPICard', () => {
  it('renders the label and value', () => {
    render(<KPICard label="Check-ins" value={3} color="#ff385c" subtitle="hoy" />)
    expect(screen.getByText('Check-ins')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('hoy')).toBeInTheDocument()
  })

  it('renders zero without crashing', () => {
    render(<KPICard label="Tareas" value={0} color="#f97316" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
```

- [ ] **Ejecutar — debe fallar**

```bash
npx vitest run __tests__/components/KPICard.test.tsx
```

- [ ] **Crear `components/dashboard/KPICard.tsx`**

```typescript
interface Props {
  label: string
  value: number | string
  color: string
  subtitle?: string
  icon?: string
}

export function KPICard({ label, value, color, subtitle, icon }: Props) {
  return (
    <div className="flex-shrink-0 rounded-xl p-4 min-w-[100px]"
         style={{ backgroundColor: `${color}18`, border: `1px solid ${color}33` }}>
      {icon && <p className="text-xl mb-1">{icon}</p>}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">{label}</p>
      <p className="text-2xl font-bold mt-0.5" style={{ color }}>{value}</p>
      {subtitle && <p className="text-[11px] text-[#94a3b8] mt-0.5">{subtitle}</p>}
    </div>
  )
}
```

- [ ] **Ejecutar tests — deben pasar**

```bash
npx vitest run __tests__/components/KPICard.test.tsx
```
Esperado: ✅ PASS

- [ ] **Crear `components/dashboard/OccupancyBar.tsx`**

```typescript
interface Props {
  name: string
  occupied: number
  total: number
}

export function OccupancyBar({ name, occupied, total }: Props) {
  const pct = total > 0 ? (occupied / total) * 100 : 0
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f97316' : '#ef4444'

  return (
    <div className="flex items-center gap-3">
      <p className="text-xs text-[#64748b] w-20 truncate flex-shrink-0">{name}</p>
      <div className="flex-1 h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-[#94a3b8] w-8 text-right flex-shrink-0">
        {occupied}/{total}
      </p>
    </div>
  )
}
```

- [ ] **Crear `components/dashboard/StockAlert.tsx`**

```typescript
import type { PropertySupply } from '@/lib/types'

interface Props {
  item: PropertySupply & {
    supply?: { name: string; unit: string }
    property?: { name: string }
  }
}

export function StockAlert({ item }: Props) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#f1f5f9] last:border-0">
      <span className="text-base">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#0f172a] truncate">
          {item.supply?.name} — {item.property?.name}
        </p>
        <p className="text-xs text-[#94a3b8]">
          Quedan {item.current_qty} {item.supply?.unit} (mín. {item.min_qty})
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Crear `actions/dashboard.ts`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import type { DashboardKPIs, OccupancyData } from '@/lib/types'
import { getOccupiedDaysInWeek } from '@/lib/utils'

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const supabase = await createClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  const [checkIns, checkOuts, pendingTasks, monthlyRevenue] = await Promise.all([
    supabase.from('reservations').select('id', { count: 'exact' })
      .eq('check_in', today).eq('status', 'confirmed'),
    supabase.from('reservations').select('id', { count: 'exact' })
      .eq('check_out', today).eq('status', 'confirmed'),
    supabase.from('tasks').select('id', { count: 'exact' })
      .in('status', ['pending', 'in_progress']),
    supabase.from('reservations').select('amount')
      .gte('check_in', monthStart).lte('check_in', monthEnd)
      .eq('status', 'confirmed'),
  ])

  const revenue = (monthlyRevenue.data ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return {
    checkInsToday: checkIns.count ?? 0,
    checkOutsToday: checkOuts.count ?? 0,
    pendingTasks: pendingTasks.count ?? 0,
    monthlyRevenue: revenue,
  }
}

export async function getWeekOccupancy(): Promise<OccupancyData[]> {
  const supabase = await createClient()
  const today = new Date()
  const weekStart = format(today, 'yyyy-MM-dd')
  const weekEnd = format(new Date(today.getTime() + 7 * 86400000), 'yyyy-MM-dd')

  const [{ data: properties }, { data: reservations }] = await Promise.all([
    supabase.from('properties').select('*').order('name'),
    supabase.from('reservations').select('property_id, check_in, check_out')
      .lte('check_in', weekEnd).gte('check_out', weekStart)
      .eq('status', 'confirmed'),
  ])

  return (properties ?? []).map(p => {
    const propReservations = (reservations ?? []).filter(r => r.property_id === p.id)
    const occupied = propReservations.reduce((sum, r) =>
      sum + getOccupiedDaysInWeek(r.check_in, r.check_out, weekStart, weekEnd), 0)
    return { property: p, daysOccupied: occupied, totalDays: 7 }
  })
}
```

- [ ] **Reemplazar `app/(app)/page.tsx`** (Dashboard completo)

```typescript
import { createClient } from '@/lib/supabase/server'
import { getDashboardKPIs, getWeekOccupancy } from '@/actions/dashboard'
import { getTasks } from '@/actions/tasks'
import { getLowStockAlerts } from '@/actions/supplies'
import { getPurchaseRequests } from '@/actions/purchases'
import { KPICard } from '@/components/dashboard/KPICard'
import { OccupancyBar } from '@/components/dashboard/OccupancyBar'
import { StockAlert } from '@/components/dashboard/StockAlert'
import { TaskCard } from '@/components/tasks/TaskCard'
import { canDo } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('team_members').select('*').eq('id', user.id).single()

  // Equipo va directo a sus tareas
  if (member && !canDo(member.role, 'dashboard:view')) {
    redirect('/tasks')
  }

  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  const [kpis, occupancy, todayTasks, stockAlerts, pendingPurchases] = await Promise.all([
    getDashboardKPIs(),
    getWeekOccupancy(),
    getTasks({ date: format(new Date(), 'yyyy-MM-dd') }),
    getLowStockAlerts(),
    getPurchaseRequests('pending'),
  ])

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="bg-white border-b border-[#e2e8f0] px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#0f172a]">
              Buenos días, {member?.name?.split(' ')[0] ?? 'Diego'} 👋
            </h1>
            <p className="text-xs text-[#94a3b8] capitalize">{today}</p>
          </div>
          <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm"
               style={{ background: 'linear-gradient(135deg, #ff385c, #ff6b6b)' }}>
            {member?.name?.[0] ?? 'D'}
          </div>
        </div>
      </div>

      {/* KPIs — scroll horizontal */}
      <div className="flex gap-3 px-4 pt-4 overflow-x-auto pb-1 scrollbar-none">
        <KPICard label="Check-ins" value={kpis.checkInsToday}
                 color="#ff385c" subtitle="hoy" icon="🏠" />
        <KPICard label="Check-outs" value={kpis.checkOutsToday}
                 color="#22c55e" subtitle="hoy" icon="🚪" />
        <KPICard label="Tareas" value={kpis.pendingTasks}
                 color="#f97316" subtitle="pendientes" icon="✅" />
        <KPICard label="Ingresos" value={`$${Math.round(kpis.monthlyRevenue / 1000)}k`}
                 color="#6366f1" subtitle="este mes" icon="💰" />
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* Alertas de stock */}
        {stockAlerts.length > 0 && (
          <section className="bg-[#fffbeb] border border-[#fde68a] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#d97706] uppercase tracking-wide mb-2">
              📦 Stock bajo ({stockAlerts.length})
            </p>
            {stockAlerts.map(a => <StockAlert key={a.id} item={a} />)}
          </section>
        )}

        {/* Solicitudes de compra pendientes */}
        {pendingPurchases.length > 0 && (
          <section className="bg-white border border-[#e2e8f0] rounded-xl p-4
                              shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
              🛒 Compras pendientes ({pendingPurchases.length})
            </p>
            <div className="space-y-2">
              {pendingPurchases.map(req => (
                <PurchaseRequestItem key={req.id} request={req} />
              ))}
            </div>
          </section>
        )}

        {/* Ocupación de la semana */}
        <section className="bg-white border border-[#e2e8f0] rounded-xl p-4
                            shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
            📅 Ocupación esta semana
          </p>
          <div className="space-y-2">
            {occupancy.map(o => (
              <OccupancyBar key={o.property.id} name={o.property.name}
                            occupied={o.daysOccupied} total={o.totalDays} />
            ))}
          </div>
        </section>

        {/* Tareas de hoy */}
        <section>
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
            ✅ Tareas de hoy ({todayTasks.length})
          </p>
          {todayTasks.length === 0 ? (
            <p className="text-sm text-[#94a3b8] text-center py-4">Sin tareas para hoy 🎉</p>
          ) : (
            <div className="space-y-3">
              {todayTasks.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// Componente inline para solicitudes de compra con acción
function PurchaseRequestItem({ request }: { request: any }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#0f172a] truncate">{request.description}</p>
        <p className="text-xs text-[#94a3b8]">{request.property?.name}</p>
      </div>
      <ResolvePurchaseButton id={request.id} />
    </div>
  )
}
```

- [ ] **Crear `components/dashboard/ResolvePurchaseButton.tsx`**

```typescript
'use client'
import { useTransition } from 'react'
import { resolvePurchaseRequest } from '@/actions/purchases'

export function ResolvePurchaseButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()
  return (
    <button onClick={() => startTransition(() => resolvePurchaseRequest(id))}
            disabled={isPending}
            className="text-xs bg-[#22c55e] text-white px-3 py-1.5 rounded-lg
                       font-medium disabled:opacity-50 active:opacity-80 flex-shrink-0">
      {isPending ? '...' : '✓ Comprado'}
    </button>
  )
}
```

- [ ] **Actualizar import en Dashboard** — agregar el import faltante en `app/(app)/page.tsx`

```typescript
// Al inicio del archivo, después de los otros imports:
import { ResolvePurchaseButton } from '@/components/dashboard/ResolvePurchaseButton'
```

- [ ] **Ejecutar todos los tests**

```bash
npx vitest run
```
Esperado: ✅ Todos los tests pasan

- [ ] **Verificar dashboard en el navegador**

```bash
npm run dev
```
- Login como admin → debe ver el dashboard con KPIs, ocupación y tareas
- Login como limpiadora → debe redirigir directamente a `/tasks`
- Los KPIs deben reflejar datos reales de la DB

- [ ] **Commit**

```bash
git add actions/dashboard.ts components/dashboard/ app/\(app\)/page.tsx
git commit -m "feat: add full dashboard with KPIs, occupancy and alerts"
```

---

## Task 13: PWA — Instalación en Móvil

**Files:**
- Modify: `next.config.ts`
- Create: `public/manifest.json`
- Create: `public/icons/icon-192.png` (generar)
- Create: `public/icons/icon-512.png` (generar)

- [ ] **Instalar next-pwa**

```bash
npm install @ducanh2912/next-pwa
```

- [ ] **Actualizar `next.config.ts`**

```typescript
import type { NextConfig } from 'next'
import withPWAInit from '@ducanh2912/next-pwa'

const withPWA = withPWAInit({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
  },
})

const nextConfig: NextConfig = {
  // cualquier config existente
}

export default withPWA(nextConfig)
```

- [ ] **Generar íconos PWA**

Opción rápida — crear íconos con Canvas desde terminal:

```bash
# Instalar sharp para generar íconos
npm install --save-dev sharp

# Crear script generate-icons.mjs
cat > generate-icons.mjs << 'EOF'
import sharp from 'sharp'
import { mkdirSync } from 'fs'

mkdirSync('public/icons', { recursive: true })

const svgIcon = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="120" fill="#ff385c"/>
  <text x="256" y="340" font-size="280" text-anchor="middle" fill="white" font-family="Arial">🏠</text>
</svg>`

const svgBuffer = Buffer.from(svgIcon)

await sharp(svgBuffer).resize(192, 192).png().toFile('public/icons/icon-192.png')
await sharp(svgBuffer).resize(512, 512).png().toFile('public/icons/icon-512.png')
console.log('✅ Icons generated')
EOF

node generate-icons.mjs
rm generate-icons.mjs
```

- [ ] **Verificar manifest en el navegador**

```bash
npm run build && npm run start
```
- Abrir en Chrome DevTools → Application → Manifest → debe mostrar AirAdmin
- En móvil: abrir URL → menú del navegador → "Agregar a pantalla de inicio"
- Debe instalarse con ícono rojo y abrirse en modo standalone (sin barra del navegador)

- [ ] **Probar instalación en iOS (Safari)**

1. Abrir la URL en Safari del iPhone
2. Tocar el botón Compartir (cuadrado con flecha)
3. Seleccionar "Añadir a pantalla de inicio"
4. La app debe abrirse sin la barra de Safari ✅

- [ ] **Verificar que el service worker registra**

En Chrome DevTools → Application → Service Workers → debe mostrar el SW activo

- [ ] **Commit final**

```bash
git add next.config.ts public/manifest.json public/icons/ .gitignore
git commit -m "feat: configure PWA with manifest, service worker and home screen install"
```

---

## ✅ Fase 4 Completada — MVP Terminado

Al finalizar esta fase tendrás el MVP **100% funcional**:

| Módulo | Estado |
|---|---|
| 📊 Dashboard con KPIs en tiempo real | ✅ |
| 📅 Calendario de reservas (Airbnb + directas) | ✅ |
| ✅ Gestión de tareas con roles | ✅ |
| 🔧 Mantenimiento con foto + prioridades | ✅ |
| 🏠 Propiedades con ficha e instrucciones | ✅ |
| 📦 Stock de insumos con alertas | ✅ |
| 🛒 Solicitudes de compra | ✅ |
| 📱 PWA instalable sin App Store | ✅ |
| 👥 3 roles con permisos diferenciados | ✅ |

---

## Deploy en Vercel

- [ ] **Subir a GitHub**

```bash
git remote add origin https://github.com/TU_USUARIO/airadmin.git
git push -u origin main
```

- [ ] **Conectar con Vercel**

1. Ir a [vercel.com/new](https://vercel.com/new)
2. Importar el repositorio
3. Agregar variables de entorno:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click "Deploy"

- [ ] **Compartir URL con el equipo**

Enviar la URL de Vercel por WhatsApp con instrucciones:
> "Entra a esta URL desde Safari/Chrome en tu teléfono, toca el menú de compartir y selecciona 'Agregar a pantalla de inicio'. Queda como una app 🎉"

---

## Resumen de los 4 planes

| Fase | Archivo | Contenido |
|---|---|---|
| 1 | `2026-05-26-airadmin-fase1-setup-auth.md` | Setup, tipos, BD, auth, shell |
| 2 | `2026-05-26-airadmin-fase2-propiedades-calendario.md` | Propiedades, calendario, reservas |
| 3 | `2026-05-26-airadmin-fase3-tareas-mantenimiento.md` | Tareas, mantenimiento, fotos |
| 4 | `2026-05-26-airadmin-fase4-insumos-dashboard-pwa.md` | Insumos, dashboard, PWA, deploy |
