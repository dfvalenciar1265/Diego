# Servidor MCP de AirAdmin — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/mcp` (MCP con OAuth 2.1 de Supabase) con las mismas 6 herramientas del GPT, la pantalla "Autorizar" y el regreso al consentimiento después del login.

**Architecture:** La lógica de cada herramienta sale de las rutas a `lib/gpt-api/service.ts`; las rutas REST y el MCP (`lib/mcp/*`, `app/api/mcp`) la usan. `mcp-handler` verifica el token (via `verifyMcpToken` → `supabase.auth.getClaims` + admin activo) y sirve el documento RFC 9728.

**Tech Stack:** Next.js 16.2, `mcp-handler@2.3.0`, `@modelcontextprotocol/server@2`, `zod@4`, Supabase JS 2.106 (`auth.oauth.*`, `auth.getClaims`), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-08-mcp-airadmin-design.md`

**Convenciones:** pruebas en `__tests__/…` con `import { describe, it, expect, vi } from 'vitest'`; `npx vitest run <archivo>`; commits con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` solo con los archivos listados. Las dependencias ya están instaladas (commit `5514e4c`). Hay una prueba que ya falla en `main` (`gmail-sync.test.ts › parses "sept"…`): no tocarla.

> ⚠️ Next.js: un `route.ts` solo puede exportar handlers HTTP y config de segmento; no exportar constantes desde rutas (van en `lib/mcp/config.ts`).

---

### Task 1: `safeNextPath` (`lib/safe-next.ts`)

**Files:** Create `lib/safe-next.ts` · Test `__tests__/lib/safe-next.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/lib/safe-next'

describe('safeNextPath', () => {
  it('keeps internal paths with their query', () => {
    expect(safeNextPath('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc')
    expect(safeNextPath('/calendar')).toBe('/calendar')
  })

  it('rejects anything that could leave the app', () => {
    expect(safeNextPath('https://evil.com')).toBeNull()
    expect(safeNextPath('//evil.com')).toBeNull()
    expect(safeNextPath('/\\evil.com')).toBeNull()
    expect(safeNextPath('javascript:alert(1)')).toBeNull()
  })

  it('returns null when there is nothing', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/safe-next.test.ts` → FAIL (no resuelve el import)

- [ ] **Step 3: Implement**

```ts
/**
 * Ruta interna segura para volver después del login (?next=…). Solo acepta rutas de la propia
 * app ("/oauth/consent?…"); otro dominio, "//evil.com" o "javascript:" → null.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/safe-next.test.ts` → PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/safe-next.ts __tests__/lib/safe-next.test.ts
git commit -m "feat: ruta segura para volver después del login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Volver a la pantalla pedida después del login (`proxy.ts`, login)

**Files:** Modify `proxy.ts`, `app/(auth)/login/page.tsx`

- [ ] **Step 1: Replace the whole `proxy.ts` with**

```ts
import { updateSession } from '@/lib/supabase/middleware'
import { safeNextPath } from '@/lib/safe-next'
import { type NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname, search } = request.nextUrl

  const isAuthPage = pathname.startsWith('/login')
  // /.well-known holds the public OAuth metadata that ChatGPT and Claude read before signing in
  const isPublic = pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.startsWith('/.well-known')
  const isProtected = !isAuthPage && !isPublic

  if (isProtected && !user) {
    const url = new URL('/login', request.url)
    // Come back here after signing in (e.g. the "Autorizar" screen of a ChatGPT connection)
    if (pathname !== '/') url.searchParams.set('next', pathname + search)
    return NextResponse.redirect(url)
  }

  if (isAuthPage && user) {
    const next = safeNextPath(request.nextUrl.searchParams.get('next')) ?? '/'
    return NextResponse.redirect(new URL(next, request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)'],
}
```

- [ ] **Step 2: Login page** — in `app/(auth)/login/page.tsx` add the import after `import { lookupEmailByName } from '@/actions/team'`:

```ts
import { safeNextPath } from '@/lib/safe-next'
```

and replace

```ts
      router.push('/')
```

with

```ts
      // Back to where the sign-in was asked for (e.g. the "Autorizar" screen), else home
      router.push(safeNextPath(new URLSearchParams(window.location.search).get('next')) ?? '/')
```

- [ ] **Step 3: Check** `npx tsc --noEmit -p tsconfig.json && npx eslint proxy.ts "app/(auth)/login/page.tsx"` → sin errores

- [ ] **Step 4: Commit**

```bash
git add proxy.ts "app/(auth)/login/page.tsx"
git commit -m "feat: después de iniciar sesión, volver a la pantalla pedida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Lógica compartida de las herramientas (`lib/gpt-api/service.ts`) y rutas REST sobre ella

**Files:** Create `lib/gpt-api/service.ts` · Modify `lib/gpt-api/http.ts`, `lib/gpt-api/maintenance.ts`, `app/api/gpt/properties/route.ts`, `app/api/gpt/maintenance/route.ts`, `app/api/gpt/maintenance/[id]/route.ts`, `app/api/gpt/reservations/route.ts`, `app/api/gpt/reservations/compare/route.ts`

Refactor sin cambio de comportamiento: las pruebas existentes deben seguir pasando y la Task 9 verifica las rutas a mano.

- [ ] **Step 1: `createMaintenance` acepta quién reporta** — in `lib/gpt-api/maintenance.ts` replace

```ts
  input: { propertyId: string; title: string; description: string; priority: MaintenancePriority },
): Promise<{ created: boolean; issue: MaintenanceOut }> {
```

with

```ts
  input: { propertyId: string; title: string; description: string; priority: MaintenancePriority; reportedBy?: string },
): Promise<{ created: boolean; issue: MaintenanceOut }> {
```

and replace

```ts
      reported_by: await diegoId(db),
```

with

```ts
      // The MCP knows who is connected; the GPT's shared key doesn't, so those stay Diego's
      reported_by: input.reportedBy ?? await diegoId(db),
```

- [ ] **Step 2: Create `lib/gpt-api/service.ts`**

```ts
/**
 * Lo que hace cada herramienta del API del GPT y del MCP, sin HTTP: valida, consulta o escribe,
 * y refresca las pantallas afectadas. Las rutas /api/gpt/* y /api/mcp solo traducen el resultado.
 */
import { revalidatePath } from 'next/cache'
import { compareReservations } from './compare'
import type { Db } from './db'
import { createMaintenance, listMaintenance, updateMaintenance } from './maintenance'
import { listProperties, resolveProperty } from './properties'
import { applyDiffNotes, listReservations, loadForCompare } from './reservations'
import {
  isUuid, parseCompareBody, parseMaintenanceFilter, parseMaintenancePatch, parseNewMaintenance, parseRange,
} from './validate'

export type ServiceResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string }

const done = <T>(data: T, status = 200): ServiceResult<T> => ({ ok: true, status, data })
const failed = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error })
const unknownProperty = (name: string) =>
  failed(404, `No reconozco el apartamento «${name}». Consulta listProperties para ver los nombres.`)

function refreshMaintenance() {
  revalidatePath('/maintenance')
  revalidatePath('/')
}

export async function propertiesTool(db: Db) {
  return done({ properties: await listProperties(db, { onlyActive: true }) })
}

export async function listMaintenanceTool(db: Db, query: { property?: string | null; status?: string | null }) {
  const status = parseMaintenanceFilter(query.status ?? null)
  if (!status.ok) return failed(400, status.error)
  let propertyId: string | undefined
  if (query.property) {
    const property = resolveProperty(query.property, await listProperties(db))
    if (!property) return unknownProperty(query.property)
    propertyId = property.id
  }
  const issues = await listMaintenance(db, { propertyId, status: status.value })
  return done({ count: issues.length, issues })
}

export async function createMaintenanceTool(db: Db, body: unknown, reportedBy?: string) {
  const input = parseNewMaintenance(body)
  if (!input.ok) return failed(400, input.error)
  const property = resolveProperty(input.value.property, await listProperties(db))
  if (!property) return unknownProperty(input.value.property)

  const result = await createMaintenance(db, {
    propertyId: property.id,
    title: input.value.title,
    description: input.value.description,
    priority: input.value.priority,
    reportedBy,
  })
  if (result.created) refreshMaintenance()
  return done(result, result.created ? 201 : 200)
}

export async function updateMaintenanceTool(db: Db, id: string, body: unknown, today: string) {
  if (!isUuid(id)) return failed(404, 'No existe ese pendiente.')
  const patch = parseMaintenancePatch(body)
  if (!patch.ok) return failed(400, patch.error)
  const result = await updateMaintenance(db, id, patch.value, today)
  if (!result) return failed(404, 'No existe ese pendiente.')
  refreshMaintenance()
  return done(result)
}

export async function listReservationsTool(
  db: Db,
  query: { from?: string | null; to?: string | null; property?: string | null },
  today: string,
) {
  const range = parseRange(query.from ?? null, query.to ?? null, today)
  if (!range.ok) return failed(400, range.error)

  const properties = await listProperties(db)
  let propertyId: string | undefined
  if (query.property) {
    const property = resolveProperty(query.property, properties)
    if (!property) return unknownProperty(query.property)
    propertyId = property.id
  }

  const rows = await listReservations(db, range.value, propertyId)
  const nameOf = new Map(properties.map(p => [p.id, p.name]))
  return done({
    ...range.value,
    count: rows.length,
    reservations: rows.map(r => ({
      airbnb_code: r.airbnb_code,
      guest_name: r.guest_name,
      property: nameOf.get(r.property_id) ?? null,
      check_in: r.check_in,
      check_out: r.check_out,
      guests: r.guests,
      status: r.status,
      source: r.source,
      notes: r.notes,
    })),
  })
}

export async function compareReservationsTool(db: Db, body: unknown, today: string) {
  const input = parseCompareBody(body)
  if (!input.ok) return failed(400, input.error)
  const { from, to, dry_run, reservations } = input.value

  const properties = await listProperties(db)
  const codes = reservations.flatMap(r => (r.code ? [r.code] : []))
  const rows = await loadForCompare(db, { from, to }, codes)
  const result = compareReservations(input.value, rows, properties)

  let noted = new Set<string>()
  let cleared = 0
  if (!dry_run) {
    ;({ noted, cleared } = await applyDiffNotes(db, rows, result, today))
    if (noted.size > 0 || cleared > 0) revalidatePath('/', 'layout')
  }

  return done({
    from,
    to,
    dry_run,
    summary: result.summary,
    differences: result.differences.map(d => ({
      ...d,
      noted: d.reservation_id ? noted.has(d.reservation_id) : false,
    })),
    unmatched: result.unmatched,
    notes_cleared: cleared,
  })
}
```

- [ ] **Step 3: `toResponse` in `lib/gpt-api/http.ts`** — add at the top, after `import { checkApiKey } from './auth'`:

```ts
import type { ServiceResult } from './service'
```

and append at the end of the file:

```ts
/** Resultado del servicio → respuesta HTTP del API del GPT. */
export function toResponse(result: ServiceResult): NextResponse {
  return result.ok ? jsonResponse(result.data, result.status) : errorResponse(result.status, result.error)
}
```

- [ ] **Step 4: Replace the five REST routes**

`app/api/gpt/properties/route.ts`:

```ts
/** GET /api/gpt/properties — apartamentos activos con su nombre exacto (GPT "AirAdmin"). */
import type { NextRequest } from 'next/server'
import { serviceDb } from '@/lib/gpt-api/db'
import { toResponse, withApiKey } from '@/lib/gpt-api/http'
import { propertiesTool } from '@/lib/gpt-api/service'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => toResponse(await propertiesTool(serviceDb())))
}
```

`app/api/gpt/maintenance/route.ts`:

```ts
/**
 * /api/gpt/maintenance (GPT "AirAdmin")
 *  - GET  → pendientes, por apartamento y estado (por defecto abiertos + en progreso)
 *  - POST → crea un pendiente reportado por Diego, sin duplicar uno abierto con el mismo título
 */
import type { NextRequest } from 'next/server'
import { serviceDb } from '@/lib/gpt-api/db'
import { readJson, toResponse, withApiKey } from '@/lib/gpt-api/http'
import { createMaintenanceTool, listMaintenanceTool } from '@/lib/gpt-api/service'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    return toResponse(await listMaintenanceTool(serviceDb(), {
      property: params.get('property'),
      status: params.get('status'),
    }))
  })
}

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => toResponse(await createMaintenanceTool(serviceDb(), await readJson(req))))
}
```

`app/api/gpt/maintenance/[id]/route.ts`:

```ts
/**
 * PATCH /api/gpt/maintenance/{id} — cambia estado, agrega una nota o registra el costo.
 * En preventivos recurrentes "resolved" equivale al botón "Hecho" de la app.
 */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { readJson, toResponse, withApiKey } from '@/lib/gpt-api/http'
import { updateMaintenanceTool } from '@/lib/gpt-api/service'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, async () => {
    const { id } = await ctx.params
    return toResponse(await updateMaintenanceTool(serviceDb(), id, await readJson(req), todayInBogota()))
  })
}
```

`app/api/gpt/reservations/route.ts`:

```ts
/** GET /api/gpt/reservations — reservas de la app con noches en el rango. Nunca devuelve montos. */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { toResponse, withApiKey } from '@/lib/gpt-api/http'
import { listReservationsTool } from '@/lib/gpt-api/service'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    return toResponse(await listReservationsTool(serviceDb(), {
      from: params.get('from'),
      to: params.get('to'),
      property: params.get('property'),
    }, todayInBogota()))
  })
}
```

`app/api/gpt/reservations/compare/route.ts`:

```ts
/**
 * POST /api/gpt/reservations/compare — compara la lista que ChatGPT leyó en Airbnb con la app.
 * Devuelve las diferencias y deja (o quita) la nota "⚠️ Diferencia con Airbnb" en las reservas;
 * con dry_run=true solo informa. Nunca cambia fechas, huéspedes, tareas ni montos.
 */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { readJson, toResponse, withApiKey } from '@/lib/gpt-api/http'
import { compareReservationsTool } from '@/lib/gpt-api/service'

export async function POST(req: NextRequest) {
  return withApiKey(req, async () =>
    toResponse(await compareReservationsTool(serviceDb(), await readJson(req), todayInBogota())))
}
```

- [ ] **Step 5: Check** `npx vitest run __tests__/lib && npx tsc --noEmit -p tsconfig.json && npx eslint app/api/gpt lib/gpt-api` → pruebas como antes (solo la falla conocida), tsc y eslint sin errores

- [ ] **Step 6: Commit**

```bash
git add lib/gpt-api/service.ts lib/gpt-api/http.ts lib/gpt-api/maintenance.ts app/api/gpt
git commit -m "refactor(gpt-api): lógica de cada herramienta en service.ts para compartirla con el MCP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verificación del token del MCP (`lib/mcp/config.ts`, `lib/mcp/auth.ts`)

**Files:** Create `lib/mcp/config.ts`, `lib/mcp/auth.ts` · Test `__tests__/lib/mcp/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildAuthInfo, memberFromAuth } from '@/lib/mcp/auth'

const ADMIN = { id: 'u1', name: 'Diego', role: 'admin', active: true }
const CLAIMS = { sub: 'u1', role: 'authenticated', exp: 2_000_000_000, client_id: 'chatgpt-client', scope: 'openid email profile' }

describe('buildAuthInfo', () => {
  it('lets an active admin in, with who they are', () => {
    expect(buildAuthInfo('tok', CLAIMS, ADMIN)).toEqual({
      token: 'tok',
      clientId: 'chatgpt-client',
      scopes: ['openid', 'email', 'profile'],
      expiresAt: 2_000_000_000,
      extra: { memberId: 'u1', memberName: 'Diego' },
    })
  })

  it('keeps out anyone who is not an active admin', () => {
    expect(buildAuthInfo('tok', CLAIMS, null)).toBeUndefined()
    expect(buildAuthInfo('tok', CLAIMS, { ...ADMIN, role: 'cleaning' })).toBeUndefined()
    expect(buildAuthInfo('tok', CLAIMS, { ...ADMIN, active: false })).toBeUndefined()
    expect(buildAuthInfo('tok', CLAIMS, { ...ADMIN, id: 'someone-else' })).toBeUndefined()
  })

  it('rejects tokens that are not a signed-in user', () => {
    expect(buildAuthInfo('tok', { ...CLAIMS, role: 'anon' }, ADMIN)).toBeUndefined()
    expect(buildAuthInfo('tok', { ...CLAIMS, role: 'service_role' }, ADMIN)).toBeUndefined()
  })

  it('copes with tokens without client_id or scope', () => {
    const info = buildAuthInfo('tok', { sub: 'u1', role: 'authenticated', exp: 1 }, ADMIN)
    expect(info?.clientId).toBe('supabase-session')
    expect(info?.scopes).toEqual([])
  })
})

describe('memberFromAuth', () => {
  it('reads who is connected', () => {
    expect(memberFromAuth(buildAuthInfo('tok', CLAIMS, ADMIN))).toEqual({ id: 'u1', name: 'Diego' })
    expect(memberFromAuth(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/mcp/auth.test.ts` → FAIL (no resuelve el import)

- [ ] **Step 3: Implement**

`lib/mcp/config.ts`:

```ts
/** Documento RFC 9728 del MCP (path insertion de /api/mcp). */
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp'

/** Servidor de autorización: el OAuth 2.1 de Supabase Auth del proyecto (su issuer). */
export const AUTH_SERVER_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
```

`lib/mcp/auth.ts`:

```ts
/**
 * Verificación del token que ChatGPT (o Claude) manda al MCP. Lo emite el OAuth 2.1 de Supabase
 * cuando alguien aprueba la pantalla "Autorizar". Solo pasan los admin activos del equipo, y se
 * vuelve a comprobar en cada llamada.
 */
import type { AuthInfo } from '@modelcontextprotocol/server'
import { createClient } from '@supabase/supabase-js'
import { serviceDb, type Db } from '@/lib/gpt-api/db'

export interface TeamMemberRef {
  id: string
  name: string
  role: string
  active: boolean
}

export interface TokenClaims {
  sub: string
  role?: string
  exp?: number
  client_id?: unknown
  scope?: unknown
}

/** Arma el AuthInfo si el token es de un usuario que es admin activo; si no, undefined. */
export function buildAuthInfo(token: string, claims: TokenClaims, member: TeamMemberRef | null): AuthInfo | undefined {
  if (claims.role !== 'authenticated') return undefined
  if (!member || member.id !== claims.sub || member.role !== 'admin' || !member.active) return undefined
  return {
    token,
    clientId: typeof claims.client_id === 'string' ? claims.client_id : 'supabase-session',
    scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    expiresAt: claims.exp,
    extra: { memberId: member.id, memberName: member.name },
  }
}

async function findMember(db: Db, id: string): Promise<TeamMemberRef | null> {
  const { data, error } = await db.from('team_members').select('id, name, role, active').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as TeamMemberRef | null) ?? null
}

/** Para withMcpAuth: undefined = sin acceso (responde 401 con el desafío OAuth). */
export async function verifyMcpToken(_req: Request, token?: string): Promise<AuthInfo | undefined> {
  if (!token) return undefined
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Checks signature (project JWKS) and expiry; with legacy symmetric keys it asks the Auth server.
  const { data, error } = await supabase.auth.getClaims(token)
  if (error || !data) return undefined
  const claims = data.claims as TokenClaims
  return buildAuthInfo(token, claims, await findMember(serviceDb(), claims.sub))
}

/** Quién está usando el MCP (lo dejó verifyMcpToken en el AuthInfo). */
export function memberFromAuth(authInfo: AuthInfo | undefined): { id: string; name: string } | null {
  const id = authInfo?.extra?.memberId
  const name = authInfo?.extra?.memberName
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/mcp/auth.test.ts && npx tsc --noEmit -p tsconfig.json` → PASS (5 tests), tsc sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/config.ts lib/mcp/auth.ts __tests__/lib/mcp/auth.test.ts
git commit -m "feat(mcp): verificación del token de Supabase y solo admins activos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Herramientas e instrucciones del MCP (`lib/mcp/tools.ts`, `lib/mcp/instructions.ts`)

**Files:** Create `lib/mcp/instructions.ts`, `lib/mcp/tools.ts` · Test `__tests__/lib/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/server'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { registerTools, toToolResult } from '@/lib/mcp/tools'

describe('toToolResult', () => {
  it('returns the same JSON as the REST API as structured content', () => {
    expect(toToolResult({ ok: true, status: 200, data: { count: 1 } })).toEqual({
      content: [{ type: 'text', text: '{"count":1}' }],
      structuredContent: { count: 1 },
    })
  })

  it('marks errors so the model explains them', () => {
    expect(toToolResult({ ok: false, status: 400, error: 'Falta "title".' })).toEqual({
      content: [{ type: 'text', text: 'Falta "title".' }],
      isError: true,
    })
  })
})

describe('registerTools', () => {
  const calls: { name: string; config: { annotations?: { readOnlyHint?: boolean } } }[] = []
  registerTools({ registerTool: (name: string, config: never) => { calls.push({ name, config }) } } as unknown as McpServer)

  it('exposes the six GPT actions', () => {
    expect(calls.map(c => c.name)).toEqual([
      'list_properties', 'list_maintenance', 'create_maintenance',
      'update_maintenance', 'list_reservations', 'compare_reservations',
    ])
  })

  it('marks only the reading tools as read-only', () => {
    const readOnly = calls.filter(c => c.config.annotations?.readOnlyHint).map(c => c.name)
    expect(readOnly).toEqual(['list_properties', 'list_maintenance', 'list_reservations'])
  })
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/mcp/tools.test.ts` → FAIL (no resuelve el import)

- [ ] **Step 3: Implement**

`lib/mcp/instructions.ts`:

```ts
/** Instrucciones del servidor MCP (las mismas reglas que el GPT "AirAdmin", con los nombres MCP). */
export const MCP_INSTRUCTIONS = `AirAdmin: apartamentos de Airbnb de Diego en Cartagena. Habla siempre en español.

APARTAMENTOS
- Usa siempre los nombres exactos que devuelve list_properties. Si te nombran un apartamento de otra forma (título de Airbnb, edificio), tradúcelo a ese nombre; si dudas, pregunta.

MANTENIMIENTO
- Antes de crear un pendiente, consulta los abiertos de ese apartamento con list_maintenance para no repetir.
- Prioridad: urgent = afecta la estadía (bichos, aire, agua, olor, seguridad, electricidad); normal = desgaste (lencería, pintura, cajones, puertas, muebles); scheduled = fotos o ficha.
- No cargues quejas de ubicación (ruido de la calle) ni cosas que ya están arregladas.
- Antes de crear un pendiente o cambiar su estado, muestra exactamente qué vas a hacer.
- Antes de decir que algo está roto o arreglado, consulta su estado en la app.
- Si marcas "resolved" un preventivo recurrente (fumigación, aires), la app no lo cierra: anota hoy como última vez y avanza la próxima fecha (scheduled_done=true). Explícalo con la nueva fecha.

REVISIÓN DE RESERVAS
- Te pegan la lista sacada de Airbnb con el modo agente. Conviértela a compare_reservations: from y to (AAAA-MM-DD) y una entrada por reserva con code (HM…), guest_name, property (nombre de la app), check_in, check_out, guests y status (confirmed o cancelled).
- Si la lista no trae el año, usa el que corresponda a fechas próximas a hoy.
- Si piden "solo mirar", envía dry_run: true (no deja notas en la app).
- Muestra el resultado en una tabla: apartamento, huésped, código y qué difiere. Después, lo que no se pudo emparejar y por qué.
- missing_in_app: sugiere correr la sincronización de Gmail en la app (Ajustes → Gmail).
- not_in_airbnb_list: puede que el agente no la haya leído; pide verificarla en Airbnb antes de concluir que se canceló.
- Nunca digas que corregiste reservas: solo se deja la nota "⚠️ Diferencia con Airbnb" en la reserva de la app.

REGLAS
- Nunca inventes arreglos, fechas ni datos. Si algo no está en la app, dilo.
- Si una herramienta responde con error, explica el mensaje en palabras simples.`
```

`lib/mcp/tools.ts`:

```ts
/**
 * Herramientas del MCP de AirAdmin: las mismas 6 del GPT, sobre lib/gpt-api/service.ts.
 * Las de solo lectura van con readOnlyHint; ChatGPT confirma con el usuario las demás.
 * Los esquemas describen los tipos; la validación con mensajes en español la hace el servicio.
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import {
  compareReservationsTool, createMaintenanceTool, listMaintenanceTool, listReservationsTool,
  propertiesTool, updateMaintenanceTool, type ServiceResult,
} from '@/lib/gpt-api/service'
import { memberFromAuth } from './auth'

const READ = { readOnlyHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

const date = z.string().describe('Fecha AAAA-MM-DD')
const airbnbReservation = z.object({
  code: z.string().nullable().optional().describe('Código de confirmación HM…'),
  guest_name: z.string(),
  property: z.string().describe('Nombre del apartamento en la app (list_properties)'),
  check_in: date,
  check_out: date,
  guests: z.number().int().nullable().optional(),
  status: z.enum(['confirmed', 'cancelled']).optional(),
})

/** Resultado del servicio → resultado de herramienta MCP (errores con isError, en español). */
export function toToolResult(result: ServiceResult): CallToolResult {
  if (!result.ok) return { content: [{ type: 'text', text: result.error }], isError: true }
  const data = result.data as Record<string, unknown>
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
}

async function run(fn: () => Promise<ServiceResult>): Promise<CallToolResult> {
  try {
    return toToolResult(await fn())
  } catch (err) {
    console.error('[mcp]', err instanceof Error ? err.message : err)
    return {
      content: [{ type: 'text', text: 'Error interno del servidor. El detalle quedó en los registros de Vercel.' }],
      isError: true,
    }
  }
}

export function registerTools(server: McpServer) {
  server.registerTool('list_properties', {
    title: 'Apartamentos',
    description: 'Lista los apartamentos activos con su nombre exacto en la app. Úsalo para traducir cualquier nombre antes de crear pendientes o comparar reservas.',
    annotations: READ,
  }, () => run(() => propertiesTool(serviceDb())))

  server.registerTool('list_maintenance', {
    title: 'Consultar pendientes',
    description: 'Pendientes de mantenimiento, más recientes primero (máx. 100). Por defecto solo abiertos y en progreso. Consúltalo antes de decir que algo está roto o arreglado.',
    inputSchema: z.object({
      property: z.string().optional().describe('Nombre del apartamento'),
      status: z.enum(['active', 'open', 'in_progress', 'resolved']).optional().describe('active = abiertos + en progreso'),
    }),
    annotations: READ,
  }, ({ property, status }) => run(() => listMaintenanceTool(serviceDb(), { property, status })))

  server.registerTool('create_maintenance', {
    title: 'Crear pendiente',
    description: 'Crea un pendiente de mantenimiento sin asignar, reportado por quien está conectado. Si ya hay uno abierto con el mismo título en ese apartamento, no duplica: devuelve created=false y el existente.',
    inputSchema: z.object({
      property: z.string().describe('Nombre exacto del apartamento (list_properties)'),
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(['urgent', 'normal', 'scheduled']).describe('urgent = afecta la estadía; normal = desgaste; scheduled = fotos o ficha'),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (args, ctx) => run(() => createMaintenanceTool(serviceDb(), args, memberFromAuth(ctx.http?.authInfo)?.id)))

  server.registerTool('update_maintenance', {
    title: 'Cambiar estado de un pendiente',
    description: 'Cambia el estado, agrega una nota con fecha o registra el costo. En preventivos recurrentes, "resolved" no lo cierra: anota hoy como última vez y avanza la próxima fecha (scheduled_done=true).',
    inputSchema: z.object({
      id: z.string().describe('id del pendiente (de list_maintenance)'),
      status: z.enum(['open', 'in_progress', 'resolved']).optional(),
      note: z.string().optional().describe('Se agrega al final de las notas, con la fecha'),
      cost: z.number().optional().describe('Costo en pesos colombianos'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, ({ id, ...patch }) => run(() => updateMaintenanceTool(serviceDb(), id, patch, todayInBogota())))

  server.registerTool('list_reservations', {
    title: 'Reservas de la app',
    description: 'Reservas de la app con noches dentro del rango (por defecto, de hoy a 60 días; máximo 120). Incluye bloqueos y reservas directas. No trae montos.',
    inputSchema: z.object({
      from: date.optional(),
      to: date.optional(),
      property: z.string().optional().describe('Nombre del apartamento'),
    }),
    annotations: READ,
  }, (query) => run(() => listReservationsTool(serviceDb(), query, todayInBogota())))

  server.registerTool('compare_reservations', {
    title: 'Comparar con Airbnb',
    description: 'Compara la lista leída en Airbnb con la app. Devuelve las diferencias y deja la nota "⚠️ Diferencia con Airbnb" en las reservas afectadas (no si dry_run=true). Nunca cambia fechas ni datos.',
    inputSchema: z.object({
      from: date,
      to: date,
      dry_run: z.boolean().optional().describe('true = solo mirar, sin dejar notas en la app'),
      reservations: z.array(airbnbReservation).describe('Una entrada por reserva leída en Airbnb'),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (body) => run(() => compareReservationsTool(serviceDb(), body, todayInBogota())))
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/mcp/tools.test.ts && npx tsc --noEmit -p tsconfig.json && npx eslint lib/mcp` → PASS (4 tests), sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/instructions.ts lib/mcp/tools.ts __tests__/lib/mcp/tools.test.ts
git commit -m "feat(mcp): las 6 herramientas del GPT como herramientas MCP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rutas del MCP y del documento RFC 9728

**Files:** Create `app/api/mcp/route.ts`, `app/.well-known/oauth-protected-resource/api/mcp/route.ts`

- [ ] **Step 1: `app/api/mcp/route.ts`**

```ts
/**
 * /api/mcp — servidor MCP de AirAdmin para los complementos de ChatGPT y para Claude.
 * Solo con un token del OAuth 2.1 de Supabase de un admin activo (lib/mcp/auth.ts); sin token
 * responde 401 con el WWW-Authenticate que lleva al documento RFC 9728.
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyMcpToken } from '@/lib/mcp/auth'
import { RESOURCE_METADATA_PATH } from '@/lib/mcp/config'
import { MCP_INSTRUCTIONS } from '@/lib/mcp/instructions'
import { registerTools } from '@/lib/mcp/tools'

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: 'airadmin', version: '1.0.0' },
  instructions: MCP_INSTRUCTIONS,
})

const authHandler = withMcpAuth(handler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: RESOURCE_METADATA_PATH,
})

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
```

- [ ] **Step 2: `app/.well-known/oauth-protected-resource/api/mcp/route.ts`**

```ts
/**
 * RFC 9728 — le dice a ChatGPT y a Claude que /api/mcp inicia sesión con el OAuth 2.1 de
 * Supabase Auth. Público (sin datos), con CORS para clientes en el navegador.
 */
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler'
import { AUTH_SERVER_URL } from '@/lib/mcp/config'

const handler = protectedResourceHandler({ authServerUrls: [AUTH_SERVER_URL] })
const options = metadataCorsOptionsRequestHandler()

export { handler as GET, options as OPTIONS }
```

- [ ] **Step 3: Check** `npx tsc --noEmit -p tsconfig.json && npx eslint app/api/mcp app/.well-known` → sin errores

- [ ] **Step 4: Commit**

```bash
git add app/api/mcp app/.well-known
git commit -m "feat(mcp): ruta /api/mcp con OAuth y documento de recurso protegido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pantalla "Autorizar" (`app/oauth/consent/page.tsx`, `actions/oauth.ts`)

**Files:** Create `actions/oauth.ts`, `app/oauth/consent/page.tsx`

- [ ] **Step 1: `actions/oauth.ts`**

```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Aprueba o rechaza la conexión que pidió ChatGPT o Claude y devuelve al usuario a esa app.
 * Al aprobar se vuelve a comprobar que sea admin activo: la pantalla solo esconde el botón.
 */
export async function decideAuthorization(formData: FormData): Promise<void> {
  const authorizationId = String(formData.get('authorization_id') ?? '')
  const approve = formData.get('decision') === 'approve'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !authorizationId) redirect('/login')

  if (approve) {
    const { data: member } = await supabase
      .from('team_members').select('role, active').eq('id', user.id).maybeSingle()
    if (member?.role !== 'admin' || member.active !== true) {
      throw new Error('Solo los administradores de AirAdmin pueden autorizar conexiones.')
    }
  }

  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
  if (error || !data) {
    throw new Error(`No se pudo ${approve ? 'autorizar' : 'rechazar'} la conexión: ${error?.message ?? 'sin datos'}`)
  }
  redirect(data.redirect_url)
}
```

- [ ] **Step 2: `app/oauth/consent/page.tsx`**

```tsx
/**
 * "Autorizar" — consentimiento del OAuth 2.1 de Supabase. Supabase manda aquí cuando ChatGPT o
 * Claude piden conectarse al MCP (Authentication → OAuth Server → Authorization Path =
 * /oauth/consent). Sin sesión, proxy.ts lleva al login y el login vuelve aquí.
 */
import { redirect } from 'next/navigation'
import { decideAuthorization } from '@/actions/oauth'
import { createClient } from '@/lib/supabase/server'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🏠</div>
          <p className="text-2xl font-bold text-[var(--text)]">AirAdmin</p>
        </div>
        <div className="bg-[var(--card)] rounded-2xl p-6 shadow-sm border border-[var(--border)]">
          {children}
        </div>
      </div>
    </div>
  )
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams
  if (!authorizationId) {
    return (
      <Shell>
        <p className="text-sm text-[var(--text)]">
          Falta el identificador de la conexión. Vuelve a conectar desde ChatGPT o Claude.
        </p>
      </Shell>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`)
  }

  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (error || !details) {
    return (
      <Shell>
        <p className="text-sm text-[var(--text)]">
          No pude leer la solicitud de conexión ({error?.message ?? 'sin datos'}). Vuelve a intentarlo desde ChatGPT o Claude.
        </p>
      </Shell>
    )
  }
  // Already approved before for these scopes: straight back to the app that asked
  if ('redirect_url' in details) redirect(details.redirect_url)

  const { data: member } = await supabase
    .from('team_members').select('name, role, active').eq('id', user.id).maybeSingle()
  const isAdmin = member?.role === 'admin' && member.active === true
  const appName = details.client.name || 'Una aplicación'

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-[var(--text)]">Conectar {appName}</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1">
        quiere usar AirAdmin como <strong className="text-[var(--text)]">{member?.name ?? details.user.email}</strong>.
      </p>

      {isAdmin ? (
        <>
          <p className="text-sm font-medium text-[var(--text)] mt-5 mb-2">Podrá:</p>
          <ul className="text-sm text-[var(--text)] space-y-1.5 list-disc pl-5">
            <li>Ver apartamentos, pendientes de mantenimiento y reservas (sin montos ni códigos de acceso).</li>
            <li>Crear pendientes y cambiar su estado, nota y costo.</li>
            <li>Dejar la nota «⚠️ Diferencia con Airbnb» en las reservas que no coinciden.</li>
          </ul>
          <p className="text-xs text-[var(--text-muted)] mt-3">No puede borrar nada.</p>
        </>
      ) : (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-5">
          Solo los administradores de AirAdmin pueden conectar ChatGPT o Claude.
        </p>
      )}

      <form action={decideAuthorization} className="flex gap-3 mt-6">
        <input type="hidden" name="authorization_id" value={details.authorization_id} />
        <button
          type="submit" name="decision" value="deny"
          className="flex-1 rounded-lg border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text)]"
        >
          Rechazar
        </button>
        {isAdmin && (
          <button
            type="submit" name="decision" value="approve"
            className="flex-1 bg-[var(--primary)] text-white rounded-lg py-2.5 text-sm font-semibold"
          >
            Autorizar
          </button>
        )}
      </form>

      <p className="text-xs text-[var(--text-muted)] mt-4">Te devolverá a {hostOf(details.redirect_uri)}.</p>
    </Shell>
  )
}
```

- [ ] **Step 3: Check** `npx tsc --noEmit -p tsconfig.json && npx eslint actions/oauth.ts app/oauth` → sin errores

- [ ] **Step 4: Commit**

```bash
git add actions/oauth.ts app/oauth
git commit -m "feat(mcp): pantalla Autorizar para conectar ChatGPT o Claude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Guía (`docs/chatgpt-airadmin.md`)

**Files:** Modify `docs/chatgpt-airadmin.md`

- [ ] **Step 1: Insert this section right after the intro paragraph (before `## 1. Poner la clave en Vercel (una sola vez)`)**

````markdown
## 0. Recomendado: conectar AirAdmin como complemento (MCP)

OpenAI retira los GPT personalizados el **11 de diciembre de 2026**. El reemplazo es el servidor
MCP de la app, que hace lo mismo que el GPT y además sabe quién está conectado.

**En ChatGPT (una sola vez):**
1. **Complementos** → **Añadir** → **Crear servidor MCP personalizado**.
2. Nombre `AirAdmin`, descripción `Mantenimiento y revisión de reservas de mis apartamentos`.
3. Conexión: punto público `https://diegoprueba.vercel.app/api/mcp`. Autenticación: **OAuth**.
4. Acepta el aviso y **Crear como complemento**.
5. ChatGPT abre AirAdmin: inicia sesión con tu nombre y contraseña y pulsa **Autorizar**.

**En Claude:** Configuración → Conectores → Añadir conector personalizado → la misma URL; al
conectar, inicia sesión y autoriza igual.

Solo los **administradores** de AirAdmin pueden conectarse. ChatGPT te pide confirmar antes de
cada herramienta que escribe (crear o cerrar pendientes, dejar notas). Las herramientas se llaman
`list_properties`, `list_maintenance`, `create_maintenance`, `update_maintenance`,
`list_reservations` y `compare_reservations`; el uso diario (secciones 4 y 5) es igual que con el GPT.

Las secciones 1 a 3 son del GPT anterior, que sigue funcionando hasta el 11 de diciembre.
````

- [ ] **Step 2: Commit**

```bash
git add docs/chatgpt-airadmin.md
git commit -m "docs: cómo conectar AirAdmin como complemento MCP en ChatGPT y Claude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verificación (la hace Claude, no el agente que implementa)

- [ ] `npx vitest run`, `npm run lint`, `npm run build` (en la lista de rutas: `/api/mcp`, `/.well-known/oauth-protected-resource/api/mcp`, `/oauth/consent`).
- [ ] Local (`.env.local` enlazado, `GPT_API_KEY` de prueba):
  - `GET /.well-known/oauth-protected-resource/api/mcp` → `resource = http://localhost:4000/api/mcp`, `authorization_servers = [<supabase>/auth/v1]`.
  - `POST /api/mcp` sin token y con token falso → `401` + `WWW-Authenticate` con `resource_metadata`.
  - `GET /oauth/consent?authorization_id=x` sin sesión → `307` a `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx`.
  - Regresión del API del GPT: properties, maintenance, validaciones 400/404, compare con `dry_run`.

### Task 10: PR, Supabase y conexión (la hace Claude con Diego)

- [ ] PR con `info-softop`, chequeos en verde, merge.
- [ ] Supabase (Chrome de Diego): Site URL, OAuth Server activado, Authorization Path `/oauth/consent`, registro dinámico.
- [ ] Metadatos de Supabase: `registration_endpoint` y `S256`.
- [ ] ChatGPT: crear el complemento; Diego inicia sesión y autoriza; probar `list_properties` y `list_maintenance`.
