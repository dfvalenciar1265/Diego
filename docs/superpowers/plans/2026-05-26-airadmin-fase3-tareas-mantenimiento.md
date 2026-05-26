# AirAdmin — Fase 3: Tareas y Mantenimiento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisito:** Fases 1 y 2 completadas.

**Goal:** Módulo de tareas de limpieza con vistas por rol, y módulo de mantenimiento con reporte de incidencias y foto.

**Architecture:** Server Components para listas + Client Components para formularios en Sheet. Upload de fotos a Supabase Storage desde el cliente.

**Tech Stack:** Next.js 15, Supabase Storage para fotos, Tailwind, shadcn/ui

---

## Estructura de Archivos (Fase 3)

```
app/(app)/
├── tasks/
│   └── page.tsx
├── maintenance/
│   └── page.tsx
components/
├── tasks/
│   ├── TaskCard.tsx
│   ├── TaskStatusButton.tsx
│   └── TaskForm.tsx
├── maintenance/
│   ├── IncidenceCard.tsx
│   ├── PriorityBadge.tsx
│   └── IncidenceForm.tsx
actions/
├── tasks.ts
└── maintenance.ts
__tests__/
└── actions/
    ├── tasks.test.ts
    └── maintenance.test.ts
```

---

## Task 9: Módulo de Tareas

**Files:**
- Create: `actions/tasks.ts`
- Create: `components/tasks/TaskCard.tsx`
- Create: `components/tasks/TaskStatusButton.tsx`
- Create: `components/tasks/TaskForm.tsx`
- Create: `app/(app)/tasks/page.tsx`
- Create: `__tests__/actions/tasks.test.ts`

- [ ] **Escribir tests para lógica de tareas** — `__tests__/actions/tasks.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { getTaskStatusLabel, getTaskStatusColor, isTaskOverdue } from '@/lib/utils'

describe('task utils', () => {
  it('returns correct label for each status', () => {
    expect(getTaskStatusLabel('pending')).toBe('Pendiente')
    expect(getTaskStatusLabel('in_progress')).toBe('En curso')
    expect(getTaskStatusLabel('done')).toBe('Completado')
  })

  it('returns correct color class for each status', () => {
    expect(getTaskStatusColor('pending')).toBe('#f97316')
    expect(getTaskStatusColor('in_progress')).toBe('#6366f1')
    expect(getTaskStatusColor('done')).toBe('#22c55e')
  })

  it('marks task as overdue if scheduled_for is past and not done', () => {
    expect(isTaskOverdue('2026-01-01', 'pending')).toBe(true)
    expect(isTaskOverdue('2099-12-31', 'pending')).toBe(false)
    expect(isTaskOverdue('2026-01-01', 'done')).toBe(false)
  })
})
```

- [ ] **Ejecutar — debe fallar**

```bash
npx vitest run __tests__/actions/tasks.test.ts
```

- [ ] **Agregar a `lib/utils.ts`**

```typescript
import type { TaskStatus, MaintenancePriority } from './types'

export function getTaskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    pending: 'Pendiente',
    in_progress: 'En curso',
    done: 'Completado',
  }
  return labels[status]
}

export function getTaskStatusColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    pending: '#f97316',
    in_progress: '#6366f1',
    done: '#22c55e',
  }
  return colors[status]
}

export function isTaskOverdue(scheduledFor: string, status: TaskStatus): boolean {
  if (status === 'done') return false
  return parseISO(scheduledFor) < startOfDay(new Date())
}

export function getPriorityLabel(priority: MaintenancePriority): string {
  const labels: Record<MaintenancePriority, string> = {
    urgent: 'Urgente',
    normal: 'Normal',
    scheduled: 'Programado',
  }
  return labels[priority]
}

export function getPriorityColor(priority: MaintenancePriority): string {
  const colors: Record<MaintenancePriority, string> = {
    urgent: '#ef4444',
    normal: '#f97316',
    scheduled: '#6366f1',
  }
  return colors[priority]
}
```

- [ ] **Ejecutar tests — deben pasar**

```bash
npx vitest run __tests__/actions/tasks.test.ts
```
Esperado: ✅ PASS

- [ ] **Crear `actions/tasks.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Task, TaskStatus } from '@/lib/types'

export async function getTasks(filters?: {
  date?: string
  assignedTo?: string
  propertyId?: string
}): Promise<Task[]> {
  const supabase = await createClient()
  let query = supabase
    .from('tasks')
    .select('*, property:properties(name), assignee:team_members(name)')
    .order('scheduled_for', { ascending: true })

  if (filters?.date) query = query.eq('scheduled_for', filters.date)
  if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
  if (filters?.propertyId) query = query.eq('property_id', filters.propertyId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createTask(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').insert({
    property_id: formData.get('property_id') as string,
    reservation_id: formData.get('reservation_id') as string || null,
    type: formData.get('type') as string,
    assigned_to: formData.get('assigned_to') as string || null,
    scheduled_for: formData.get('scheduled_for') as string,
    notes: formData.get('notes') as string || '',
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('tasks').update({
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  }).eq('id', id)
  revalidatePath('/tasks')
  revalidatePath('/')
}
```

- [ ] **Crear `components/tasks/TaskCard.tsx`**

```typescript
'use client'
import { useTransition } from 'react'
import { updateTaskStatus } from '@/actions/tasks'
import { getTaskStatusLabel, getTaskStatusColor, isTaskOverdue, formatDate } from '@/lib/utils'
import type { Task, TaskStatus } from '@/lib/types'

interface Props {
  task: Task & { property?: { name: string }; assignee?: { name: string } }
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: null,
}

const TYPE_ICON: Record<string, string> = {
  cleaning: '🧹',
  preparation: '🛏️',
  other: '📋',
}

export function TaskCard({ task }: Props) {
  const [isPending, startTransition] = useTransition()
  const nextStatus = NEXT_STATUS[task.status]
  const overdue = isTaskOverdue(task.scheduled_for, task.status)
  const color = getTaskStatusColor(task.status)

  function advance() {
    if (!nextStatus) return
    startTransition(() => updateTaskStatus(task.id, nextStatus))
  }

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4
                     ${overdue ? 'border-[#ef4444]' : 'border-[#e2e8f0]'}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
             style={{ backgroundColor: `${color}22` }}>
          {TYPE_ICON[task.type] ?? '📋'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-[#0f172a] text-sm">{task.property?.name ?? '—'}</p>
            {overdue && (
              <span className="text-[10px] bg-[#fee2e2] text-[#ef4444] px-2 py-0.5 rounded-full font-semibold">
                ATRASADA
              </span>
            )}
          </div>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            {getTaskStatusLabel(task.type === 'cleaning' ? 'pending' : 'pending').replace('Pendiente', '')}
            {task.assignee?.name ?? 'Sin asignar'} · {formatDate(task.scheduled_for)}
          </p>
          {task.notes && (
            <p className="text-xs text-[#64748b] mt-1 italic">{task.notes}</p>
          )}
        </div>
        <span className="text-xs font-medium px-2 py-1 rounded-full flex-shrink-0"
              style={{ backgroundColor: `${color}22`, color }}>
          {getTaskStatusLabel(task.status)}
        </span>
      </div>

      {nextStatus && (
        <button onClick={advance} disabled={isPending}
                className="mt-3 w-full h-10 rounded-lg text-sm font-semibold
                           active:opacity-80 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: getTaskStatusColor(nextStatus), color: 'white' }}>
          {isPending ? '...' : nextStatus === 'in_progress' ? '▶ Iniciar' : '✓ Completar'}
        </button>
      )}

      {task.status === 'done' && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm">✅</span>
          <span className="text-xs text-[#22c55e] font-medium">
            Completado{task.completed_at ? ` · ${formatDate(task.completed_at.split('T')[0])}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Crear `components/tasks/TaskForm.tsx`**

```typescript
'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTask } from '@/actions/tasks'
import type { Property, TeamMember } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  properties: Property[]
  teamMembers: TeamMember[]
  defaultPropertyId?: string
  defaultDate?: string
}

export function TaskForm({ open, onClose, properties, teamMembers, defaultPropertyId, defaultDate }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createTask(formData)
      if (!result.success) { setError(result.error ?? 'Error'); return }
      onClose()
    })
  }

  const cleaners = teamMembers.filter(m => m.role === 'cleaning' || m.role === 'admin')

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Nueva tarea</SheetTitle>
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
            <Label>Tipo *</Label>
            <select name="type" defaultValue="cleaning"
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm">
              <option value="cleaning">🧹 Limpieza</option>
              <option value="preparation">🛏️ Preparación</option>
              <option value="other">📋 Otro</option>
            </select>
          </div>
          <div>
            <Label>Asignar a</Label>
            <select name="assigned_to"
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm">
              <option value="">Sin asignar</option>
              {cleaners.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Fecha programada *</Label>
            <Input name="scheduled_for" type="date" required
                   defaultValue={defaultDate ?? new Date().toISOString().split('T')[0]}
                   className="mt-1" />
          </div>
          <div>
            <Label>Notas</Label>
            <Input name="notes" placeholder="Instrucciones especiales..." className="mt-1" />
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <Button type="submit" disabled={isPending}
                  className="w-full h-12" style={{ background: '#ff385c' }}>
            {isPending ? 'Guardando...' : 'Crear tarea'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Crear `app/(app)/tasks/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTasks } from '@/actions/tasks'
import { getProperties } from '@/actions/properties'
import { TaskCard } from '@/components/tasks/TaskCard'
import { PageHeader } from '@/components/layout/PageHeader'
import { TasksClient } from '@/components/tasks/TasksClient'

export default async function TasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: member } = await supabase
    .from('team_members').select('*').eq('id', user!.id).single()

  // Admin ve todas. Equipo ve solo las suyas.
  const filters = member?.role !== 'admin' ? { assignedTo: user!.id } : {}
  const [tasks, properties] = await Promise.all([
    getTasks(filters),
    getProperties(),
  ])

  const { data: teamMembers } = await supabase
    .from('team_members').select('*').eq('active', true)

  return (
    <>
      <PageHeader
        title={member?.role === 'admin' ? 'Todas las tareas' : 'Mis tareas'}
        action={member?.role === 'admin' ? (
          <TasksClient properties={properties} teamMembers={teamMembers ?? []} />
        ) : null}
      />
      <div className="p-4 space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-[#94a3b8]">No hay tareas pendientes</p>
          </div>
        ) : (
          tasks.map(t => <TaskCard key={t.id} task={t} />)
        )}
      </div>
    </>
  )
}
```

- [ ] **Crear `components/tasks/TasksClient.tsx`** (botón "+ Tarea" para admin)

```typescript
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TaskForm } from './TaskForm'
import type { Property, TeamMember } from '@/lib/types'

interface Props { properties: Property[]; teamMembers: TeamMember[] }

export function TasksClient({ properties, teamMembers }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} style={{ background: '#ff385c' }}>
        + Tarea
      </Button>
      <TaskForm open={open} onClose={() => setOpen(false)}
                properties={properties} teamMembers={teamMembers} />
    </>
  )
}
```

- [ ] **Verificar en el navegador**

```bash
npm run dev
```
- Ir a `/tasks` → lista de tareas
- Crear tarea → aparece con botón "Iniciar"
- Tocar "Iniciar" → cambia a "En curso"
- Tocar "Completar" → cambia a "Completado ✅"

- [ ] **Commit**

```bash
git add actions/tasks.ts components/tasks/ app/\(app\)/tasks/
git commit -m "feat: add tasks module with status progression per role"
```

---

## Task 10: Módulo de Mantenimiento

**Files:**
- Create: `actions/maintenance.ts`
- Create: `components/maintenance/PriorityBadge.tsx`
- Create: `components/maintenance/IncidenceCard.tsx`
- Create: `components/maintenance/IncidenceForm.tsx`
- Create: `app/(app)/maintenance/page.tsx`

- [ ] **Crear `actions/maintenance.ts`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { MaintenanceIssue, MaintenanceStatus } from '@/lib/types'

export async function getMaintenance(filters?: {
  status?: MaintenanceStatus
  propertyId?: string
}): Promise<MaintenanceIssue[]> {
  const supabase = await createClient()
  let query = supabase
    .from('maintenance')
    .select('*, property:properties(name), reporter:team_members!reported_by(name), assignee:team_members!assigned_to(name)')
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.propertyId) query = query.eq('property_id', filters.propertyId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createMaintenanceIssue(
  formData: FormData,
  photoUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from('maintenance').insert({
    property_id: formData.get('property_id') as string,
    title: formData.get('title') as string,
    description: formData.get('description') as string || '',
    photo_url: photoUrl ?? null,
    priority: formData.get('priority') as string || 'normal',
    reported_by: user!.id,
  })
  if (error) return { success: false, error: error.message }
  revalidatePath('/maintenance')
  revalidatePath('/')
  return { success: true }
}

export async function updateMaintenanceStatus(
  id: string,
  status: MaintenanceStatus,
  notes?: string
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('maintenance').update({
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    notes: notes ?? '',
  }).eq('id', id)
  revalidatePath('/maintenance')
  revalidatePath('/')
}

export async function assignMaintenance(
  id: string,
  assignedTo: string,
  priority: string
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('maintenance').update({ assigned_to: assignedTo, priority }).eq('id', id)
  revalidatePath('/maintenance')
}

export async function uploadMaintenancePhoto(file: File): Promise<string | null> {
  const supabase = await createClient()
  const filename = `maintenance/${Date.now()}-${file.name.replace(/\s/g, '_')}`
  const { error } = await supabase.storage.from('photos').upload(filename, file)
  if (error) return null
  const { data } = supabase.storage.from('photos').getPublicUrl(filename)
  return data.publicUrl
}
```

- [ ] **Crear `components/maintenance/PriorityBadge.tsx`**

```typescript
import { getPriorityLabel, getPriorityColor } from '@/lib/utils'
import type { MaintenancePriority } from '@/lib/types'

export function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  const color = getPriorityColor(priority)
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}22`, color }}>
      {getPriorityLabel(priority)}
    </span>
  )
}
```

- [ ] **Crear `components/maintenance/IncidenceCard.tsx`**

```typescript
'use client'
import { useTransition } from 'react'
import { updateMaintenanceStatus } from '@/actions/maintenance'
import { PriorityBadge } from './PriorityBadge'
import { formatDate } from '@/lib/utils'
import type { MaintenanceIssue, MaintenanceStatus } from '@/lib/types'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'

interface Props {
  issue: MaintenanceIssue & {
    property?: { name: string }
    reporter?: { name: string }
    assignee?: { name: string }
  }
}

const NEXT_STATUS: Partial<Record<MaintenanceStatus, MaintenanceStatus>> = {
  open: 'in_progress',
  in_progress: 'resolved',
}

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  open: 'Abierto',
  in_progress: 'En proceso',
  resolved: 'Resuelto',
}

const STATUS_COLOR: Record<MaintenanceStatus, string> = {
  open: '#ef4444',
  in_progress: '#f97316',
  resolved: '#22c55e',
}

export function IncidenceCard({ issue }: Props) {
  const [isPending, startTransition] = useTransition()
  const { member } = useCurrentUser()
  const role = member?.role ?? 'cleaning'
  const canManage = canDo(role, 'maintenance:manage')
  const nextStatus = NEXT_STATUS[issue.status]
  const statusColor = STATUS_COLOR[issue.status]

  function advance() {
    if (!nextStatus) return
    startTransition(() => updateMaintenanceStatus(issue.id, nextStatus))
  }

  return (
    <div className={`bg-white rounded-xl border shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden
                     ${issue.priority === 'urgent' ? 'border-[#ef4444]' : 'border-[#e2e8f0]'}`}>
      {issue.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={issue.photo_url} alt="Foto de incidencia"
             className="w-full h-32 object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#0f172a] text-sm">{issue.title}</p>
            <p className="text-xs text-[#94a3b8]">
              {issue.property?.name} · {formatDate(issue.created_at.split('T')[0])}
            </p>
          </div>
          <PriorityBadge priority={issue.priority} />
        </div>

        {issue.description && (
          <p className="text-xs text-[#64748b] mb-3">{issue.description}</p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${statusColor}22`, color: statusColor }}>
            {STATUS_LABEL[issue.status]}
          </span>
          {issue.assignee && (
            <span className="text-xs text-[#94a3b8]">🔧 {issue.assignee.name}</span>
          )}
        </div>

        {canManage && nextStatus && (
          <button onClick={advance} disabled={isPending}
                  className="mt-3 w-full h-10 rounded-lg text-sm font-semibold text-white
                             active:opacity-80 disabled:opacity-50"
                  style={{ backgroundColor: STATUS_COLOR[nextStatus] }}>
            {isPending ? '...' : nextStatus === 'in_progress' ? '▶ Iniciar' : '✓ Resolver'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Crear `components/maintenance/IncidenceForm.tsx`**

```typescript
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
      setPhotoPreview(null)
      onClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Reportar incidencia</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          <div>
            <Label>Apartamento *</Label>
            <select name="property_id"
                    className="w-full mt-1 rounded-lg border border-[#e2e8f0] p-3 text-sm" required>
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
                  <img src={photoPreview} alt="Preview"
                       className="w-full h-40 object-cover rounded-xl border border-[#e2e8f0]" />
                  <button type="button" onClick={() => { setPhotoPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                          className="absolute top-2 right-2 bg-white rounded-full w-7 h-7 text-sm border border-[#e2e8f0]">
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
```

- [ ] **Crear `app/(app)/maintenance/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { getMaintenance } from '@/actions/maintenance'
import { getProperties } from '@/actions/properties'
import { IncidenceCard } from '@/components/maintenance/IncidenceCard'
import { PageHeader } from '@/components/layout/PageHeader'
import { MaintenanceClient } from '@/components/maintenance/MaintenanceClient'

export default async function MaintenancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user!.id).single()

  const [issues, properties] = await Promise.all([
    getMaintenance(),
    getProperties(),
  ])

  const open = issues.filter(i => i.status !== 'resolved')
  const resolved = issues.filter(i => i.status === 'resolved')

  return (
    <>
      <PageHeader title="Mantenimiento"
        action={<MaintenanceClient properties={properties} />} />
      <div className="p-4 space-y-4">
        {open.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">
              Abiertas ({open.length})
            </p>
            <div className="space-y-3">
              {open.map(i => <IncidenceCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}
        {resolved.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">
              Resueltas
            </p>
            <div className="space-y-3 opacity-60">
              {resolved.slice(0, 5).map(i => <IncidenceCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}
        {issues.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🔧</p>
            <p className="text-[#94a3b8]">Sin incidencias activas</p>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Crear `components/maintenance/MaintenanceClient.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { IncidenceForm } from './IncidenceForm'
import type { Property } from '@/lib/types'

export function MaintenanceClient({ properties }: { properties: Property[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} style={{ background: '#ff385c' }}>
        + Reportar
      </Button>
      <IncidenceForm open={open} onClose={() => setOpen(false)} properties={properties} />
    </>
  )
}
```

- [ ] **Verificar en el navegador**

```bash
npm run dev
```
- Ir a `/maintenance` → lista vacía con botón "+ Reportar"
- Reportar incidencia con foto tomada desde cámara del móvil
- Foto debe aparecer en la tarjeta
- Botón "Iniciar" / "Resolver" según rol

- [ ] **Commit**

```bash
git add actions/maintenance.ts components/maintenance/ app/\(app\)/maintenance/
git commit -m "feat: add maintenance module with photo upload and priority management"
```

---

## ✅ Fase 3 Completada

Al finalizar esta fase tendrás:
- Tareas de limpieza con estados (pendiente → en curso → completado)
- Vistas diferenciadas: admin ve todo, equipo ve solo sus tareas
- Mantenimiento con foto desde cámara, prioridades y estados
- Upload real de fotos a Supabase Storage

**Siguiente:** [Fase 4 — Insumos, Dashboard y PWA](./2026-05-26-airadmin-fase4-insumos-dashboard-pwa.md)
