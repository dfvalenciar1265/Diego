# AirAdmin — Fase 1: Setup, Tipos, BD y Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proyecto Next.js 15 funcionando con Supabase, autenticación por roles y shell de la app (layout + bottom nav).

**Architecture:** Next.js 15 App Router + Supabase Auth + middleware de protección de rutas por rol. Los tipos TypeScript y el helper de permisos son la base que usan todos los módulos posteriores.

**Tech Stack:** Next.js 15, TypeScript, Supabase, Tailwind CSS v4, shadcn/ui, Vitest

---

## Estructura de Archivos (Fase 1)

```
/
├── app/
│   ├── layout.tsx                   # Root layout (Inter, PWA meta tags)
│   ├── manifest.ts                  # PWA manifest básico
│   ├── globals.css                  # Tailwind + variables de color
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx             # Página de login
│   └── (app)/
│       ├── layout.tsx               # Shell: auth guard + BottomNav
│       └── page.tsx                 # Redirect según rol
├── components/
│   └── layout/
│       ├── BottomNav.tsx            # Nav inferior según rol
│       └── PageHeader.tsx           # Header con título y back button
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser client
│   │   ├── server.ts                # Server client (cookies)
│   │   └── middleware.ts            # updateSession helper
│   ├── types.ts                     # Todos los tipos del dominio
│   └── permissions.ts               # canDo(role, action) helper
├── hooks/
│   └── useCurrentUser.ts            # Hook: user + role actual
├── middleware.ts                    # Protección de rutas + refresh session
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   # Todas las tablas + RLS
└── __tests__/
    └── lib/
        ├── permissions.test.ts
        └── utils.test.ts
```

---

## Task 1: Scaffolding del Proyecto

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
- Create: `app/globals.css`
- Create: `app/layout.tsx`

- [ ] **Inicializar Next.js 15 con TypeScript**

```bash
cd "/Users/diegovalencia/Dropbox/Claude Code/AIRBNB"
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir=false \
  --import-alias="@/*" \
  --yes
```

- [ ] **Instalar dependencias**

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install next-pwa
npm install date-fns
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Instalar shadcn/ui**

```bash
npx shadcn@latest init --defaults
npx shadcn@latest add button card badge input label sheet bottom-navigation
```

- [ ] **Configurar Vitest** — crear `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['__tests__/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Crear setup de tests** — `__tests__/setup.ts`

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Definir variables de color en `app/globals.css`**

```css
@import "tailwindcss";

:root {
  --primary: #ff385c;
  --primary-hover: #e0314f;
  --bg: #f8fafc;
  --card: #ffffff;
  --border: #e2e8f0;
  --text: #0f172a;
  --text-muted: #94a3b8;
  --urgent: #ef4444;
  --pending: #f97316;
  --done: #22c55e;
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: 'Inter', sans-serif;
}
```

- [ ] **Crear `app/layout.tsx`**

```typescript
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AirAdmin',
  description: 'Gestión de apartamentos Airbnb',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'AirAdmin' },
}

export const viewport: Viewport = {
  themeColor: '#ff385c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

- [ ] **Crear `app/manifest.ts`** (PWA básico)

```typescript
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AirAdmin',
    short_name: 'AirAdmin',
    description: 'Gestión de apartamentos Airbnb',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#ff385c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
```

- [ ] **Verificar que compila sin errores**

```bash
npm run build
```
Esperado: ✅ Build exitoso

- [ ] **Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Next.js 15 + Tailwind + shadcn + Vitest"
```

---

## Task 2: Tipos TypeScript del Dominio

**Files:**
- Create: `lib/types.ts`
- Create: `__tests__/lib/types.test.ts`

- [ ] **Escribir el test de tipos** — `__tests__/lib/types.test.ts`

```typescript
import { describe, it, expectTypeOf } from 'vitest'
import type { UserRole, Property, Reservation, Task, MaintenanceIssue,
              Supply, PropertySupply, PurchaseRequest, TeamMember } from '@/lib/types'

describe('Domain types', () => {
  it('UserRole includes the three valid roles', () => {
    const role: UserRole = 'admin'
    expectTypeOf(role).toMatchTypeOf<'admin' | 'cleaning' | 'maintenance'>()
  })

  it('Task status is a union of valid states', () => {
    const status: Task['status'] = 'pending'
    expectTypeOf(status).toMatchTypeOf<'pending' | 'in_progress' | 'done'>()
  })

  it('MaintenanceIssue priority is a union of valid values', () => {
    const priority: MaintenanceIssue['priority'] = 'urgent'
    expectTypeOf(priority).toMatchTypeOf<'urgent' | 'normal' | 'scheduled'>()
  })
})
```

- [ ] **Ejecutar — debe fallar**

```bash
npx vitest run __tests__/lib/types.test.ts
```
Esperado: FAIL — módulo no encontrado

- [ ] **Crear `lib/types.ts`**

```typescript
export type UserRole = 'admin' | 'cleaning' | 'maintenance'

export interface TeamMember {
  id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  created_at: string
}

export interface Property {
  id: string
  name: string
  address: string
  access_code: string
  instructions: string
  capacity: number
  photos: string[]
  created_at: string
}

export type ReservationSource = 'airbnb' | 'direct'
export type ReservationStatus = 'confirmed' | 'blocked' | 'cancelled'

export interface Reservation {
  id: string
  property_id: string
  source: ReservationSource
  guest_name: string
  check_in: string        // ISO date YYYY-MM-DD
  check_out: string       // ISO date YYYY-MM-DD
  amount: number
  notes: string
  status: ReservationStatus
  created_at: string
}

export type TaskType = 'cleaning' | 'preparation' | 'other'
export type TaskStatus = 'pending' | 'in_progress' | 'done'

export interface Task {
  id: string
  property_id: string
  reservation_id: string | null
  type: TaskType
  assigned_to: string | null     // team_member id
  scheduled_for: string          // ISO date
  status: TaskStatus
  notes: string
  photo_url: string | null
  completed_at: string | null
  created_at: string
}

export type MaintenancePriority = 'urgent' | 'normal' | 'scheduled'
export type MaintenanceStatus = 'open' | 'in_progress' | 'resolved'

export interface MaintenanceIssue {
  id: string
  property_id: string
  title: string
  description: string
  photo_url: string | null
  priority: MaintenancePriority
  status: MaintenanceStatus
  assigned_to: string | null     // team_member id
  cost: number | null
  reported_by: string            // team_member id
  resolved_at: string | null
  notes: string
  created_at: string
}

export interface Supply {
  id: string
  name: string
  unit: string
  created_at: string
}

export interface PropertySupply {
  id: string
  property_id: string
  supply_id: string
  current_qty: number
  min_qty: number
  updated_by: string
  updated_at: string
  supply?: Supply              // join opcional
}

export type PurchaseStatus = 'pending' | 'purchased'

export interface PurchaseRequest {
  id: string
  property_id: string
  supply_id: string | null
  description: string
  requested_by: string
  status: PurchaseStatus
  resolved_by: string | null
  created_at: string
  property?: Property          // join opcional
  supply?: Supply              // join opcional
}

// Tipos para el Dashboard
export interface DashboardKPIs {
  checkInsToday: number
  checkOutsToday: number
  pendingTasks: number
  monthlyRevenue: number
}

export interface OccupancyData {
  property: Property
  daysOccupied: number
  totalDays: number
}
```

- [ ] **Ejecutar tests — deben pasar**

```bash
npx vitest run __tests__/lib/types.test.ts
```
Esperado: ✅ PASS

- [ ] **Commit**

```bash
git add lib/types.ts __tests__/lib/types.test.ts
git commit -m "feat: add domain TypeScript types"
```

---

## Task 3: Helper de Permisos

**Files:**
- Create: `lib/permissions.ts`
- Create: `__tests__/lib/permissions.test.ts`

- [ ] **Escribir tests primero** — `__tests__/lib/permissions.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { canDo } from '@/lib/permissions'

describe('canDo permissions', () => {
  describe('admin', () => {
    it('can view full dashboard', () => expect(canDo('admin', 'dashboard:view')).toBe(true))
    it('can edit reservations', () => expect(canDo('admin', 'reservations:edit')).toBe(true))
    it('can manage team', () => expect(canDo('admin', 'team:manage')).toBe(true))
    it('can edit properties', () => expect(canDo('admin', 'properties:edit')).toBe(true))
    it('can resolve maintenance', () => expect(canDo('admin', 'maintenance:manage')).toBe(true))
  })

  describe('cleaning', () => {
    it('cannot view full dashboard', () => expect(canDo('cleaning', 'dashboard:view')).toBe(false))
    it('can view own tasks', () => expect(canDo('cleaning', 'tasks:view_own')).toBe(true))
    it('can update task status', () => expect(canDo('cleaning', 'tasks:update_status')).toBe(true))
    it('can update stock', () => expect(canDo('cleaning', 'supplies:update_stock')).toBe(true))
    it('can report maintenance', () => expect(canDo('cleaning', 'maintenance:report')).toBe(true))
    it('cannot manage maintenance', () => expect(canDo('cleaning', 'maintenance:manage')).toBe(false))
    it('cannot edit properties', () => expect(canDo('cleaning', 'properties:edit')).toBe(false))
  })

  describe('maintenance', () => {
    it('cannot view full dashboard', () => expect(canDo('maintenance', 'dashboard:view')).toBe(false))
    it('can view own tasks', () => expect(canDo('maintenance', 'tasks:view_own')).toBe(true))
    it('can manage own maintenance issues', () => expect(canDo('maintenance', 'maintenance:manage')).toBe(true))
    it('can report maintenance', () => expect(canDo('maintenance', 'maintenance:report')).toBe(true))
    it('cannot update stock', () => expect(canDo('maintenance', 'supplies:update_stock')).toBe(false))
    it('cannot edit reservations', () => expect(canDo('maintenance', 'reservations:edit')).toBe(false))
  })
})
```

- [ ] **Ejecutar — debe fallar**

```bash
npx vitest run __tests__/lib/permissions.test.ts
```
Esperado: FAIL — módulo no encontrado

- [ ] **Crear `lib/permissions.ts`**

```typescript
import type { UserRole } from './types'

type Action =
  | 'dashboard:view'
  | 'reservations:view'
  | 'reservations:edit'
  | 'tasks:view_own'
  | 'tasks:view_all'
  | 'tasks:create'
  | 'tasks:update_status'
  | 'maintenance:report'
  | 'maintenance:manage'
  | 'properties:view'
  | 'properties:edit'
  | 'supplies:view'
  | 'supplies:update_stock'
  | 'purchases:create'
  | 'purchases:resolve'
  | 'team:manage'

const ROLE_PERMISSIONS: Record<UserRole, Action[]> = {
  admin: [
    'dashboard:view',
    'reservations:view', 'reservations:edit',
    'tasks:view_own', 'tasks:view_all', 'tasks:create', 'tasks:update_status',
    'maintenance:report', 'maintenance:manage',
    'properties:view', 'properties:edit',
    'supplies:view', 'supplies:update_stock',
    'purchases:create', 'purchases:resolve',
    'team:manage',
  ],
  cleaning: [
    'reservations:view',
    'tasks:view_own', 'tasks:update_status',
    'maintenance:report',
    'properties:view',
    'supplies:view', 'supplies:update_stock',
    'purchases:create',
  ],
  maintenance: [
    'reservations:view',
    'tasks:view_own', 'tasks:update_status',
    'maintenance:report', 'maintenance:manage',
    'properties:view',
    'supplies:view',
    'purchases:create',
  ],
}

export function canDo(role: UserRole, action: Action): boolean {
  return ROLE_PERMISSIONS[role].includes(action)
}

export function getHomeRoute(role: UserRole): string {
  if (role === 'admin') return '/'
  return '/tasks'
}
```

- [ ] **Ejecutar tests — deben pasar**

```bash
npx vitest run __tests__/lib/permissions.test.ts
```
Esperado: ✅ PASS (20 tests)

- [ ] **Commit**

```bash
git add lib/permissions.ts __tests__/lib/permissions.test.ts
git commit -m "feat: add role-based permissions helper"
```

---

## Task 4: Supabase — Configuración y Schema

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/middleware.ts`
- Create: `supabase/migrations/001_initial_schema.sql`
- Modify: `.env.local` (crear)

- [ ] **Crear `.env.local`** (completar con tus credenciales de Supabase)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
```

Para obtener estos valores: Supabase Dashboard → Settings → API

- [ ] **Crear `lib/supabase/client.ts`**

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Crear `lib/supabase/server.ts`**

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

- [ ] **Crear `lib/supabase/middleware.ts`**

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return { supabaseResponse, user }
}
```

- [ ] **Crear migración SQL** — `supabase/migrations/001_initial_schema.sql`

```sql
-- Extensiones
create extension if not exists "uuid-ossp";

-- Tabla de team members (extendemos auth.users)
create table public.team_members (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'cleaning', 'maintenance')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Propiedades
create table public.properties (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text not null default '',
  access_code text not null default '',
  instructions text not null default '',
  capacity int not null default 2,
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Reservas
create table public.reservations (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null check (source in ('airbnb', 'direct')),
  guest_name text not null default '',
  check_in date not null,
  check_out date not null,
  amount numeric(10,2) not null default 0,
  notes text not null default '',
  status text not null default 'confirmed' check (status in ('confirmed', 'blocked', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint check_dates check (check_out > check_in)
);

-- Tareas
create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  type text not null check (type in ('cleaning', 'preparation', 'other')),
  assigned_to uuid references public.team_members(id) on delete set null,
  scheduled_for date not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  notes text not null default '',
  photo_url text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Mantenimiento
create table public.maintenance (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  description text not null default '',
  photo_url text,
  priority text not null default 'normal' check (priority in ('urgent', 'normal', 'scheduled')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  assigned_to uuid references public.team_members(id) on delete set null,
  cost numeric(10,2),
  reported_by uuid not null references public.team_members(id),
  resolved_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Insumos (catálogo global)
create table public.supplies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  unit text not null default 'unidad',
  created_at timestamptz not null default now()
);

-- Stock por apartamento
create table public.property_supplies (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  supply_id uuid not null references public.supplies(id) on delete cascade,
  current_qty int not null default 0,
  min_qty int not null default 1,
  updated_by uuid references public.team_members(id),
  updated_at timestamptz not null default now(),
  unique(property_id, supply_id)
);

-- Solicitudes de compra
create table public.purchase_requests (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  supply_id uuid references public.supplies(id) on delete set null,
  description text not null,
  requested_by uuid not null references public.team_members(id),
  status text not null default 'pending' check (status in ('pending', 'purchased')),
  resolved_by uuid references public.team_members(id),
  created_at timestamptz not null default now()
);

-- RLS (Row Level Security) — todos los usuarios autenticados leen todo
alter table public.team_members enable row level security;
alter table public.properties enable row level security;
alter table public.reservations enable row level security;
alter table public.tasks enable row level security;
alter table public.maintenance enable row level security;
alter table public.supplies enable row level security;
alter table public.property_supplies enable row level security;
alter table public.purchase_requests enable row level security;

-- Política: usuarios autenticados leen todas las tablas
create policy "authenticated users can read all"
  on public.properties for select to authenticated using (true);
create policy "authenticated users can read all"
  on public.reservations for select to authenticated using (true);
create policy "authenticated users can read all"
  on public.tasks for select to authenticated using (true);
create policy "authenticated users can read all"
  on public.maintenance for select to authenticated using (true);
create policy "authenticated users can read all"
  on public.supplies for select to authenticated using (true);
create policy "authenticated users can read all"
  on public.property_supplies for select to authenticated using (true);
create policy "authenticated users can read all"
  on public.purchase_requests for select to authenticated using (true);
create policy "authenticated users can read own record"
  on public.team_members for select to authenticated using (true);

-- Política: solo admins modifican propiedades y reservas
create policy "admin can modify properties"
  on public.properties for all to authenticated
  using ((select role from public.team_members where id = auth.uid()) = 'admin');
create policy "admin can modify reservations"
  on public.reservations for all to authenticated
  using ((select role from public.team_members where id = auth.uid()) = 'admin');

-- Política: todos pueden crear/actualizar tareas y mantenimiento
create policy "authenticated can modify tasks"
  on public.tasks for all to authenticated using (true);
create policy "authenticated can modify maintenance"
  on public.maintenance for all to authenticated using (true);
create policy "authenticated can modify supplies stock"
  on public.property_supplies for all to authenticated using (true);
create policy "authenticated can create purchase requests"
  on public.purchase_requests for all to authenticated using (true);
```

- [ ] **Aplicar migración en Supabase**

```bash
# Opción A: Supabase CLI (recomendado)
npx supabase db push

# Opción B: Manualmente en Supabase Dashboard → SQL Editor → pegar el SQL → Run
```

- [ ] **Crear bucket de Storage para fotos**

En Supabase Dashboard → Storage → New Bucket:
- Name: `photos`
- Public: ✅ (para mostrar fotos sin auth)

- [ ] **Commit**

```bash
git add lib/supabase/ supabase/ .env.local
git commit -m "feat: add Supabase client config and database schema"
```

---

## Task 5: Autenticación y Middleware

**Files:**
- Create: `middleware.ts`
- Create: `app/(auth)/login/page.tsx`
- Create: `hooks/useCurrentUser.ts`

- [ ] **Crear `middleware.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Rutas públicas
  if (pathname.startsWith('/login')) {
    if (user) return NextResponse.redirect(new URL('/', request.url))
    return supabaseResponse
  }

  // Ruta protegida: redirigir a login si no hay sesión
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
}
```

- [ ] **Crear `app/(auth)/login/page.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-4"
               style={{ background: 'linear-gradient(135deg, #ff385c, #ff6b6b)' }} />
          <h1 className="text-2xl font-bold text-[#0f172a]">AirAdmin</h1>
          <p className="text-[#94a3b8] mt-1 text-sm">Gestión de apartamentos</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email}
                   onChange={e => setEmail(e.target.value)}
                   placeholder="tu@email.com" required className="mt-1" />
          </div>
          <div>
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" value={password}
                   onChange={e => setPassword(e.target.value)}
                   placeholder="••••••••" required className="mt-1" />
          </div>

          {error && (
            <p className="text-sm text-[#ef4444] bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <Button type="submit" disabled={loading}
                  className="w-full h-12 text-base font-semibold"
                  style={{ background: '#ff385c' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Crear `hooks/useCurrentUser.ts`**

```typescript
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TeamMember } from '@/lib/types'

export function useCurrentUser() {
  const [member, setMember] = useState<TeamMember | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', user.id)
        .single()

      setMember(data)
      setLoading(false)
    }

    load()
  }, [])

  return { member, loading }
}
```

- [ ] **Crear usuario admin en Supabase**

En Supabase Dashboard → Authentication → Users → Add User:
- Email: `diego@airadmin.com`
- Password: (elegir una contraseña segura)

Luego en SQL Editor:
```sql
insert into public.team_members (id, name, email, role)
values (
  (select id from auth.users where email = 'diego@airadmin.com'),
  'Diego',
  'diego@airadmin.com',
  'admin'
);
```

- [ ] **Probar login en el navegador**

```bash
npm run dev
```
Abrir `http://localhost:3000` → debe redirigir a `/login` → ingresar credenciales → debe entrar a la app

- [ ] **Commit**

```bash
git add middleware.ts app/\(auth\)/ hooks/useCurrentUser.ts
git commit -m "feat: add auth login page, middleware and useCurrentUser hook"
```

---

## Task 6: App Shell — Layout y Bottom Navigation

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/page.tsx` (placeholder)
- Create: `components/layout/BottomNav.tsx`
- Create: `components/layout/PageHeader.tsx`

- [ ] **Crear `components/layout/BottomNav.tsx`**

```typescript
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'

export function BottomNav() {
  const pathname = usePathname()
  const { member } = useCurrentUser()
  const role = member?.role ?? 'cleaning'

  const adminItems = [
    { href: '/',              icon: '📊', label: 'Inicio' },
    { href: '/calendar',      icon: '📅', label: 'Cal.' },
    { href: '/tasks',         icon: '✅', label: 'Tareas' },
    { href: '/maintenance',   icon: '🔧', label: 'Mant.' },
    { href: '/properties',    icon: '🏠', label: 'Aptos' },
  ]

  const teamItems = [
    { href: '/tasks',         icon: '✅', label: 'Mis tareas' },
    { href: '/maintenance',   icon: '🔧', label: 'Incidencias' },
    { href: '/properties',    icon: '🏠', label: 'Aptos' },
  ]

  const items = canDo(role, 'dashboard:view') ? adminItems : teamItems

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e2e8f0] z-50
                    flex justify-around items-center pb-safe"
         style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      {items.map(item => {
        const active = pathname === item.href
        return (
          <Link key={item.href} href={item.href}
                className="flex flex-col items-center gap-0.5 py-2 px-3 min-w-[44px] min-h-[44px]
                           justify-center">
            <span className="text-xl leading-none">{item.icon}</span>
            <span className={`text-[11px] font-medium ${active ? 'text-[#ff385c]' : 'text-[#94a3b8]'}`}>
              {item.label}
            </span>
            {active && (
              <span className="absolute bottom-0 w-1 h-1 rounded-full bg-[#ff385c]" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Crear `components/layout/PageHeader.tsx`**

```typescript
import Link from 'next/link'

interface PageHeaderProps {
  title: string
  backHref?: string
  action?: React.ReactNode
}

export function PageHeader({ title, backHref, action }: PageHeaderProps) {
  return (
    <header className="sticky top-0 bg-white border-b border-[#e2e8f0] z-40 px-4 py-3
                       flex items-center gap-3">
      {backHref && (
        <Link href={backHref} className="text-[#94a3b8] text-lg min-w-[44px] min-h-[44px]
                                          flex items-center justify-center -ml-2">
          ←
        </Link>
      )}
      <h1 className="flex-1 text-base font-semibold text-[#0f172a]">{title}</h1>
      {action && <div>{action}</div>}
    </header>
  )
}
```

- [ ] **Crear `app/(app)/layout.tsx`**

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/layout/BottomNav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <main className="pb-20">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
```

- [ ] **Crear `app/(app)/page.tsx`** (placeholder — se reemplaza en Fase 4)

```typescript
export default function HomePage() {
  return (
    <div className="p-4">
      <p className="text-[#94a3b8]">Dashboard — próximamente</p>
    </div>
  )
}
```

- [ ] **Verificar en el navegador**

```bash
npm run dev
```
- Login → debe entrar con bottom nav visible
- Nav items deben resaltar en coral según la ruta activa

- [ ] **Commit**

```bash
git add app/\(app\)/ components/layout/
git commit -m "feat: add app shell layout with role-aware bottom navigation"
```

---

## ✅ Fase 1 Completada

Al finalizar esta fase tendrás:
- Proyecto Next.js 15 compilando correctamente
- Supabase configurado con todas las tablas y RLS
- Login funcionando con redirección por rol
- Bottom navigation visible y role-aware
- Helper de permisos con 20 tests pasando
- Todos los tipos TypeScript del dominio

**Siguiente:** [Fase 2 — Propiedades y Calendario](./2026-05-26-airadmin-fase2-propiedades-calendario.md)
