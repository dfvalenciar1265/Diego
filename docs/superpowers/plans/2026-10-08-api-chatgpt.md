# API para ChatGPT — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rutas `/api/gpt/*` protegidas con una clave para que un GPT personalizado ("AirAdmin") cree, consulte y cierre pendientes de mantenimiento y compare las reservas de Airbnb con las de la app.

**Architecture:** Lógica en `lib/gpt-api/` (funciones puras con pruebas + funciones de base de datos con el cliente de servicio de Supabase); rutas delgadas en `app/api/gpt/**/route.ts` que verifican la clave, validan y llaman a la lógica. Un esquema OpenAPI 3.1 servido en `/api/gpt/openapi.json` para crear el GPT.

**Tech Stack:** Next.js 16.2 (App Router, Route Handlers), Supabase JS 2, TypeScript, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-08-api-chatgpt-design.md`

**Convenciones del repo:**
- Pruebas en `__tests__/lib/...`, con `import { describe, it, expect } from 'vitest'` y alias `@/`.
- Correr pruebas: `npx vitest run <archivo>`.
- Comentarios de código en inglés o español como el archivo vecino; mensajes al usuario en español.
- `params` en rutas dinámicas es una Promesa (`await ctx.params`).
- Hay **una prueba que ya falla en `main`** (`gmail-sync.test.ts › parses "sept"…`); no es de este trabajo. No tocarla.

---

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `lib/gpt-api/dates.ts` (nuevo) | Hoy en Colombia, fecha corta "13-oct", validación y aritmética de fechas |
| `lib/maintenance-schedule.ts` (nuevo) | `advanceNextDue`: próxima fecha de un preventivo (compartida con la app) |
| `actions/maintenance.ts` (modificar) | `completeScheduledMaintenance` usa `advanceNextDue` |
| `lib/gpt-api/auth.ts` (nuevo) | `checkApiKey`: Bearer + comparación de tiempo constante |
| `lib/gpt-api/properties.ts` (nuevo) | `normalizeText`, `resolveProperty` (puras), `listProperties` (DB) |
| `lib/gpt-api/validate.ts` (nuevo) | Validación de entradas y tipos de entrada |
| `lib/gpt-api/notes.ts` (nuevo) | Poner/quitar la nota "⚠️ Diferencia con Airbnb" |
| `lib/gpt-api/compare.ts` (nuevo) | `compareReservations` (pura) |
| `lib/gpt-api/db.ts` (nuevo) | Cliente de servicio y tipo `Db` |
| `lib/gpt-api/http.ts` (nuevo) | `withApiKey`, `jsonResponse`, `errorResponse`, `readJson` |
| `lib/gpt-api/maintenance.ts` (nuevo) | Listar / crear / actualizar pendientes + `appendMaintenanceNote` (pura) |
| `lib/gpt-api/reservations.ts` (nuevo) | Leer reservas y aplicar notas de diferencia |
| `lib/gpt-api/openapi.ts` (nuevo) | `buildOpenApi(origin)` |
| `app/api/gpt/properties/route.ts` (nuevo) | GET |
| `app/api/gpt/maintenance/route.ts` (nuevo) | GET, POST |
| `app/api/gpt/maintenance/[id]/route.ts` (nuevo) | PATCH |
| `app/api/gpt/reservations/route.ts` (nuevo) | GET |
| `app/api/gpt/reservations/compare/route.ts` (nuevo) | POST |
| `app/api/gpt/openapi.json/route.ts` (nuevo) | GET (público) |
| `docs/chatgpt-airadmin.md` (nuevo) | Guía para Diego |

---

### Task 1: Fechas (`lib/gpt-api/dates.ts`)

**Files:**
- Create: `lib/gpt-api/dates.ts`
- Test: `__tests__/lib/gpt-api/dates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { todayInBogota, shortDate, isIsoDate, addDays, daysBetween } from '@/lib/gpt-api/dates'

describe('todayInBogota', () => {
  it('uses the Colombian day, not the UTC one', () => {
    // 02:00 UTC on the 9th is still 9 p.m. on the 8th in Cartagena
    expect(todayInBogota(new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-08')
    expect(todayInBogota(new Date('2026-10-08T15:00:00Z'))).toBe('2026-10-08')
  })
})

describe('shortDate', () => {
  it('formats as day-month in Spanish', () => {
    expect(shortDate('2026-10-13')).toBe('13-oct')
    expect(shortDate('2027-01-05')).toBe('5-ene')
  })
})

describe('isIsoDate', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isIsoDate('2026-10-08')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('8/10/2026')).toBe(false)
    expect(isIsoDate(20261008)).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-10-08', -30)).toBe('2026-09-08')
    expect(daysBetween('2026-10-08', '2027-02-05')).toBe(120)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/dates.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/dates"`

- [ ] **Step 3: Write the implementation**

```ts
/** Fechas del API para ChatGPT. "Hoy" es el día en Colombia, no en UTC. */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Fecha de hoy en Colombia (YYYY-MM-DD). Desde las 7 p. m. de Colombia, en UTC ya es mañana. */
export function todayInBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** "2026-10-13" → "13-oct" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}-${MONTHS[m - 1]}`
}

/** ¿Es una fecha real en formato YYYY-MM-DD? */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/dates.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/dates.ts __tests__/lib/gpt-api/dates.test.ts
git commit -m "feat(gpt-api): fechas en hora de Colombia

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Próxima fecha de preventivos (`lib/maintenance-schedule.ts`)

**Files:**
- Create: `lib/maintenance-schedule.ts`
- Modify: `actions/maintenance.ts` (función `completeScheduledMaintenance`)
- Test: `__tests__/lib/maintenance-schedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { advanceNextDue } from '@/lib/maintenance-schedule'

describe('advanceNextDue', () => {
  it('moves a recurring preventive forward by its interval', () => {
    expect(advanceNextDue('2026-09-16', 1)).toBe('2026-10-16')   // fumigación mensual
    expect(advanceNextDue('2026-09-16', 3)).toBe('2026-12-16')   // aires cada 3 meses
    expect(advanceNextDue('2026-11-20', 3)).toBe('2027-02-20')
  })

  it('lands on the last day when the target month is shorter', () => {
    expect(advanceNextDue('2026-01-31', 1)).toBe('2026-02-28')
    expect(advanceNextDue('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('leaves the next date empty without an interval', () => {
    expect(advanceNextDue('2026-10-08', null)).toBeNull()
    expect(advanceNextDue('2026-10-08', 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/maintenance-schedule.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/maintenance-schedule"`

- [ ] **Step 3: Write the implementation**

`lib/maintenance-schedule.ts`:

```ts
/**
 * Próxima fecha de un preventivo recurrente: `today` (YYYY-MM-DD) + N meses.
 * Si el mes destino es más corto, cae en su último día (31-ene + 1 → 28-feb).
 * Sin intervalo → null: queda vacía para reprogramarla a mano.
 */
export function advanceNextDue(today: string, intervalMonths: number | null | undefined): string | null {
  if (!intervalMonths || intervalMonths <= 0) return null
  const [y, m, d] = today.split('-').map(Number)
  const monthIndex = m - 1 + intervalMonths
  const year = y + Math.floor(monthIndex / 12)
  const month = monthIndex % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
```

En `actions/maintenance.ts`, agregar el import arriba (después de los imports existentes):

```ts
import { advanceNextDue } from '@/lib/maintenance-schedule'
```

y reemplazar este bloque dentro de `completeScheduledMaintenance`:

```ts
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  let nextDue: string | null = null
  const interval = issue?.interval_months
  if (interval && interval > 0) {
    const d = new Date(today)
    d.setMonth(d.getMonth() + interval)
    nextDue = d.toISOString().slice(0, 10)
  }
```

por:

```ts
  const todayStr = new Date().toISOString().slice(0, 10)
  const nextDue = advanceNextDue(todayStr, issue?.interval_months)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/maintenance-schedule.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (3 tests) y tsc sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/maintenance-schedule.ts actions/maintenance.ts __tests__/lib/maintenance-schedule.test.ts
git commit -m "refactor: próxima fecha de preventivos en una función compartida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Clave del API (`lib/gpt-api/auth.ts`)

**Files:**
- Create: `lib/gpt-api/auth.ts`
- Test: `__tests__/lib/gpt-api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { checkApiKey } from '@/lib/gpt-api/auth'

const KEY = 'test-key-0123456789-abcdefghijklmnopqrstuvwxyz'

describe('checkApiKey', () => {
  it('keeps the API closed when no usable key is configured', () => {
    expect(checkApiKey(`Bearer ${KEY}`, undefined)).toMatchObject({ ok: false, status: 503 })
    expect(checkApiKey('Bearer short', 'short')).toMatchObject({ ok: false, status: 503 })
  })

  it('rejects missing or wrong keys', () => {
    expect(checkApiKey(null, KEY)).toMatchObject({ ok: false, status: 401 })
    expect(checkApiKey('Bearer nope', KEY)).toMatchObject({ ok: false, status: 401 })
    expect(checkApiKey(KEY, KEY)).toMatchObject({ ok: false, status: 401 })
    expect(checkApiKey(`Bearer ${KEY}x`, KEY)).toMatchObject({ ok: false, status: 401 })
  })

  it('lets the right key in', () => {
    expect(checkApiKey(`Bearer ${KEY}`, KEY)).toEqual({ ok: true })
    expect(checkApiKey(`bearer ${KEY}`, KEY)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/auth.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/auth"`

- [ ] **Step 3: Write the implementation**

```ts
import { timingSafeEqual } from 'node:crypto'

/** Una clave más corta que esto no protege: mejor dejar el API cerrado. */
const MIN_KEY_LENGTH = 32

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string }

/**
 * Verifica `Authorization: Bearer <clave>` contra GPT_API_KEY. Sin clave configurada
 * (o demasiado corta) el API queda cerrado para todos, nunca abierto.
 */
export function checkApiKey(header: string | null, expected: string | undefined): AuthResult {
  if (!expected || expected.length < MIN_KEY_LENGTH) {
    return { ok: false, status: 503, error: 'El API para ChatGPT no está configurado (falta GPT_API_KEY en el servidor).' }
  }
  const given = Buffer.from(header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '')
  const wanted = Buffer.from(expected)
  // timingSafeEqual throws on different lengths, so compare those first.
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, status: 401, error: 'Clave del API inválida o ausente.' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/auth.ts __tests__/lib/gpt-api/auth.test.ts
git commit -m "feat(gpt-api): verificación de la clave del API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Apartamentos (`lib/gpt-api/properties.ts`) y cliente de servicio (`lib/gpt-api/db.ts`)

**Files:**
- Create: `lib/gpt-api/db.ts`
- Create: `lib/gpt-api/properties.ts`
- Test: `__tests__/lib/gpt-api/properties.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveProperty, normalizeText } from '@/lib/gpt-api/properties'

const PROPS = [
  { id: 'p708', name: 'Tocahagua 708' },
  { id: 'p1208', name: 'Tocahagua 1208' },
  { id: 'p1001', name: 'Palmetto 1001' },
  // real id of Cartagena Beach Crespo 1214 (its Airbnb aliases live in lib/gmail-sync.ts)
  { id: '2be6deec-8061-453e-b1ae-ce0bd177fadd', name: 'Cartagena Beach Crespo 1214' },
]

describe('normalizeText', () => {
  it('drops accents, case and extra spaces', () => {
    expect(normalizeText('  Ángel   del MAR ')).toBe('angel del mar')
  })
})

describe('resolveProperty', () => {
  it('finds the apartment by its app name, ignoring case and accents', () => {
    expect(resolveProperty('pálmetto 1001', PROPS)?.id).toBe('p1001')
    expect(resolveProperty('TOCAHAGUA 708 · Vista al mar', PROPS)?.id).toBe('p708')
  })

  it('does not confuse Tocahagua 708 with 1208', () => {
    expect(resolveProperty('Tocahagua 1208', PROPS)?.id).toBe('p1208')
  })

  it('falls back to the Airbnb listing aliases', () => {
    expect(resolveProperty('Loft Moderno vista Mar en Cartagena Ángel del Mar', PROPS)?.id)
      .toBe('2be6deec-8061-453e-b1ae-ce0bd177fadd')
  })

  it('returns null for an unknown apartment', () => {
    expect(resolveProperty('Casa Toro', PROPS)).toBeNull()
    expect(resolveProperty('', PROPS)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/properties.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/properties"`

- [ ] **Step 3: Write the implementation**

`lib/gpt-api/db.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

/** Cliente de servicio (salta RLS): solo en el servidor, nunca en el navegador. */
export function serviceDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export type Db = ReturnType<typeof serviceDb>
```

`lib/gpt-api/properties.ts`:

```ts
import { resolvePropertyId } from '@/lib/gmail-sync'
import type { Db } from './db'

export interface PropertyRef {
  id: string
  name: string
}

/** Minúsculas, sin tildes y con espacios simples, para comparar nombres. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Apartamento de la app que nombra un texto ("Palmetto 1001", "palmetto 1001 · Frente al mar…").
 * Gana el nombre más largo contenido en el texto; si ninguno, los alias de la sincronización de
 * Gmail (room ID o título del anuncio, p. ej. "Loft Moderno … Ángel del Mar" → Cartagena Beach 1214).
 */
export function resolveProperty(text: string, properties: PropertyRef[]): PropertyRef | null {
  const haystack = normalizeText(text)
  if (!haystack) return null
  const byName = [...properties]
    .sort((a, b) => b.name.length - a.name.length)
    .find(p => haystack.includes(normalizeText(p.name)))
  if (byName) return byName
  const aliasId = resolvePropertyId(text)
  return properties.find(p => p.id === aliasId) ?? null
}

/** Apartamentos (id y nombre, nada más: nunca códigos de acceso ni direcciones). */
export async function listProperties(db: Db, opts: { onlyActive?: boolean } = {}): Promise<PropertyRef[]> {
  let query = db.from('properties').select('id, name').order('name')
  if (opts.onlyActive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as PropertyRef[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/properties.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/db.ts lib/gpt-api/properties.ts __tests__/lib/gpt-api/properties.test.ts
git commit -m "feat(gpt-api): reconocer apartamentos por nombre o alias de Airbnb

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Validación (`lib/gpt-api/validate.ts`)

**Files:**
- Create: `lib/gpt-api/validate.ts`
- Test: `__tests__/lib/gpt-api/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  parseCompareBody, parseRange, parseNewMaintenance, parseMaintenancePatch,
  parseMaintenanceFilter, isUuid,
} from '@/lib/gpt-api/validate'

const item = {
  code: ' hmabc 123 ', guest_name: 'Laura', property: 'Palmetto 1001',
  check_in: '2026-10-10', check_out: '2026-10-13', guests: 2,
}
const body = (over: Record<string, unknown> = {}) =>
  ({ from: '2026-10-08', to: '2026-10-30', reservations: [item], ...over })

describe('parseCompareBody', () => {
  it('accepts a valid list and normalizes codes', () => {
    expect(parseCompareBody(body({ to: '2026-12-07' }))).toEqual({
      ok: true,
      value: {
        from: '2026-10-08', to: '2026-12-07', dry_run: false,
        reservations: [{ ...item, code: 'HMABC123', status: 'confirmed' }],
      },
    })
  })

  it('passes dry_run through', () => {
    const r = parseCompareBody(body({ dry_run: true }))
    expect(r.ok && r.value.dry_run).toBe(true)
  })

  it('refuses an empty list', () => {
    expect(parseCompareBody(body({ reservations: [] }))).toEqual({
      ok: false, error: 'La lista de Airbnb llegó vacía; no comparo para no marcar todo como faltante.',
    })
  })

  it('refuses ranges longer than 120 days', () => {
    expect(parseCompareBody(body({ to: '2027-02-06' })).ok).toBe(false)
    expect(parseCompareBody(body({ to: '2027-02-05' })).ok).toBe(true)
  })

  it('says which reservation is wrong', () => {
    expect(parseCompareBody(body({ reservations: [item, { ...item, check_out: '2026-10-10' }] }))).toEqual({
      ok: false, error: 'Reserva #2: "check_out" debe ser posterior a "check_in".',
    })
  })

  it('rejects impossible dates, unknown statuses and fractional guests', () => {
    expect(parseCompareBody(body({ from: '2026-02-30' })).ok).toBe(false)
    expect(parseCompareBody(body({ reservations: [{ ...item, status: 'pending' }] })).ok).toBe(false)
    expect(parseCompareBody(body({ reservations: [{ ...item, guests: 2.5 }] })).ok).toBe(false)
  })

  it('caps the list at 300 bookings', () => {
    expect(parseCompareBody(body({ reservations: Array.from({ length: 301 }, () => item) })).ok).toBe(false)
  })
})

describe('parseRange', () => {
  it('defaults to today plus 60 days', () => {
    expect(parseRange(null, null, '2026-10-08')).toEqual({ ok: true, value: { from: '2026-10-08', to: '2026-12-07' } })
  })

  it('rejects a range that ends before it starts', () => {
    expect(parseRange('2026-10-10', '2026-10-01', '2026-10-08')).toEqual({
      ok: false, error: '"to" no puede ser anterior a "from".',
    })
  })
})

describe('parseNewMaintenance', () => {
  it('accepts a valid issue', () => {
    expect(parseNewMaintenance({ property: 'Palmetto 1001', title: 'Desagüe lento', priority: 'urgent' })).toEqual({
      ok: true, value: { property: 'Palmetto 1001', title: 'Desagüe lento', description: '', priority: 'urgent' },
    })
  })

  it('requires a known priority and a title', () => {
    expect(parseNewMaintenance({ property: 'Palmetto 1001', title: 'x', priority: 'alta' })).toEqual({
      ok: false, error: '"priority" debe ser "urgent", "normal" o "scheduled".',
    })
    expect(parseNewMaintenance({ property: 'Palmetto 1001', title: '  ', priority: 'normal' })).toEqual({
      ok: false, error: 'Falta "title".',
    })
  })
})

describe('parseMaintenancePatch', () => {
  it('accepts status, note and cost', () => {
    expect(parseMaintenancePatch({ status: 'resolved', note: 'Listo', cost: 80000 })).toEqual({
      ok: true, value: { status: 'resolved', note: 'Listo', cost: 80000 },
    })
  })

  it('needs at least one change', () => {
    expect(parseMaintenancePatch({})).toEqual({ ok: false, error: 'Envía al menos "status", "note" o "cost".' })
  })

  it('rejects negative costs and unknown statuses', () => {
    expect(parseMaintenancePatch({ cost: -1 }).ok).toBe(false)
    expect(parseMaintenancePatch({ status: 'closed' }).ok).toBe(false)
  })
})

describe('parseMaintenanceFilter', () => {
  it('defaults to active and accepts the known statuses', () => {
    expect(parseMaintenanceFilter(null)).toEqual({ ok: true, value: 'active' })
    expect(parseMaintenanceFilter('resolved')).toEqual({ ok: true, value: 'resolved' })
    expect(parseMaintenanceFilter('closed').ok).toBe(false)
  })
})

describe('isUuid', () => {
  it('recognizes Supabase ids', () => {
    expect(isUuid('2be6deec-8061-453e-b1ae-ce0bd177fadd')).toBe(true)
    expect(isUuid('123')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/validate.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/validate"`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Validación de lo que manda ChatGPT. Los errores van en español: el GPT se los explica a Diego.
 */
import type { MaintenancePriority, MaintenanceStatus } from '@/lib/types'
import { isIsoDate, addDays, daysBetween } from './dates'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
type Failure = { ok: false; error: string }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = (error: string): Failure => ({ ok: false, error })

export const LIMITS = {
  rangeDays: 120,
  defaultRangeDays: 60,
  reservations: 300,
  title: 120,
  text: 1000,
  name: 100,
  property: 200,
  code: 20,
  guests: 50,
} as const

const PRIORITIES = ['urgent', 'normal', 'scheduled'] as const
const STATUSES = ['open', 'in_progress', 'resolved'] as const
const FILTERS = ['active', ...STATUSES] as const

export interface Range {
  from: string
  to: string
}

/** Una reserva tal como la leyó ChatGPT en Airbnb. */
export interface AirbnbReservationInput {
  code: string | null
  guest_name: string
  property: string
  check_in: string
  check_out: string
  guests: number | null
  status: 'confirmed' | 'cancelled'
}

export interface CompareInput extends Range {
  dry_run: boolean
  reservations: AirbnbReservationInput[]
}

export interface NewMaintenanceInput {
  property: string
  title: string
  description: string
  priority: MaintenancePriority
}

export interface MaintenancePatch {
  status?: MaintenanceStatus
  note?: string
  cost?: number
}

/** `active` = abiertos + en progreso. */
export type MaintenanceFilter = MaintenanceStatus | 'active'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

function text(v: unknown, field: string, max: number, required: boolean): Parsed<string> {
  if (v === undefined || v === null || v === '') return required ? fail(`Falta "${field}".`) : ok('')
  if (typeof v !== 'string') return fail(`"${field}" debe ser texto.`)
  const s = v.trim()
  if (required && !s) return fail(`Falta "${field}".`)
  if (s.length > max) return fail(`"${field}" es muy largo (máximo ${max} caracteres).`)
  return ok(s)
}

function checkRange(from: string, to: string): Parsed<Range> {
  if (to < from) return fail('"to" no puede ser anterior a "from".')
  if (daysBetween(from, to) > LIMITS.rangeDays) return fail(`El rango máximo es de ${LIMITS.rangeDays} días.`)
  return ok({ from, to })
}

export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/** Rango de GET /reservations: por defecto, de hoy a 60 días. */
export function parseRange(from: string | null, to: string | null, today: string): Parsed<Range> {
  const f = from || today
  if (!isIsoDate(f)) return fail('"from" debe ser una fecha AAAA-MM-DD.')
  const t = to || addDays(f, LIMITS.defaultRangeDays)
  if (!isIsoDate(t)) return fail('"to" debe ser una fecha AAAA-MM-DD.')
  return checkRange(f, t)
}

export function parseCompareBody(body: unknown): Parsed<CompareInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const { from, to, dry_run: dryRun, reservations: list } = body
  if (!isIsoDate(from)) return fail('"from" debe ser una fecha AAAA-MM-DD.')
  if (!isIsoDate(to)) return fail('"to" debe ser una fecha AAAA-MM-DD.')
  const range = checkRange(from, to)
  if (!range.ok) return range
  if (dryRun !== undefined && typeof dryRun !== 'boolean') return fail('"dry_run" debe ser true o false.')
  if (!Array.isArray(list)) return fail('"reservations" debe ser una lista.')
  if (list.length === 0) return fail('La lista de Airbnb llegó vacía; no comparo para no marcar todo como faltante.')
  if (list.length > LIMITS.reservations) return fail(`Máximo ${LIMITS.reservations} reservas por envío.`)

  const reservations: AirbnbReservationInput[] = []
  for (const [i, raw] of list.entries()) {
    const parsed = parseAirbnbReservation(raw)
    if (!parsed.ok) return fail(`Reserva #${i + 1}: ${parsed.error}`)
    reservations.push(parsed.value)
  }
  return ok({ ...range.value, dry_run: dryRun === true, reservations })
}

function parseAirbnbReservation(raw: unknown): Parsed<AirbnbReservationInput> {
  if (!isRecord(raw)) return fail('debe ser un objeto.')
  const code = text(raw.code, 'code', LIMITS.code, false)
  if (!code.ok) return code
  const guest = text(raw.guest_name, 'guest_name', LIMITS.name, true)
  if (!guest.ok) return guest
  const property = text(raw.property, 'property', LIMITS.property, true)
  if (!property.ok) return property

  const checkIn = raw.check_in
  const checkOut = raw.check_out
  if (!isIsoDate(checkIn)) return fail('"check_in" debe ser una fecha AAAA-MM-DD.')
  if (!isIsoDate(checkOut)) return fail('"check_out" debe ser una fecha AAAA-MM-DD.')
  if (checkOut <= checkIn) return fail('"check_out" debe ser posterior a "check_in".')

  let guests: number | null = null
  if (raw.guests !== undefined && raw.guests !== null) {
    const g = raw.guests
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 1 || g > LIMITS.guests) {
      return fail(`"guests" debe ser un entero entre 1 y ${LIMITS.guests}.`)
    }
    guests = g
  }

  const status = raw.status ?? 'confirmed'
  if (!oneOf(status, ['confirmed', 'cancelled'] as const)) return fail('"status" debe ser "confirmed" o "cancelled".')

  return ok({
    code: code.value ? code.value.replace(/\s+/g, '').toUpperCase() : null,
    guest_name: guest.value,
    property: property.value,
    check_in: checkIn,
    check_out: checkOut,
    guests,
    status,
  })
}

export function parseNewMaintenance(body: unknown): Parsed<NewMaintenanceInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const property = text(body.property, 'property', LIMITS.name, true)
  if (!property.ok) return property
  const title = text(body.title, 'title', LIMITS.title, true)
  if (!title.ok) return title
  const description = text(body.description, 'description', LIMITS.text, false)
  if (!description.ok) return description
  const priority = body.priority
  if (!oneOf(priority, PRIORITIES)) return fail('"priority" debe ser "urgent", "normal" o "scheduled".')
  return ok({ property: property.value, title: title.value, description: description.value, priority })
}

export function parseMaintenancePatch(body: unknown): Parsed<MaintenancePatch> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const patch: MaintenancePatch = {}
  const status = body.status
  if (status !== undefined) {
    if (!oneOf(status, STATUSES)) return fail('"status" debe ser "open", "in_progress" o "resolved".')
    patch.status = status
  }
  if (body.note !== undefined) {
    const note = text(body.note, 'note', LIMITS.text, true)
    if (!note.ok) return note
    patch.note = note.value
  }
  if (body.cost !== undefined) {
    const cost = body.cost
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
      return fail('"cost" debe ser un número mayor o igual a 0.')
    }
    patch.cost = cost
  }
  if (Object.keys(patch).length === 0) return fail('Envía al menos "status", "note" o "cost".')
  return ok(patch)
}

export function parseMaintenanceFilter(status: string | null): Parsed<MaintenanceFilter> {
  if (!status) return ok('active')
  if (!oneOf(status, FILTERS)) return fail('"status" debe ser "active", "open", "in_progress" o "resolved".')
  return ok(status)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/validate.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (16 tests) y tsc sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/validate.ts __tests__/lib/gpt-api/validate.test.ts
git commit -m "feat(gpt-api): validación de entradas con errores en español

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Nota de diferencia (`lib/gpt-api/notes.ts`)

**Files:**
- Create: `lib/gpt-api/notes.ts`
- Test: `__tests__/lib/gpt-api/notes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { setDiffNote, clearDiffNote } from '@/lib/gpt-api/notes'

const BASE = 'Check-in: 3:00 PM | Check-out: 11:00 AM'
const TODAY = '2026-10-08'

describe('setDiffNote', () => {
  it('adds the mark after the existing notes', () => {
    expect(setDiffNote(BASE, 'Salida 13-oct en Airbnb, 12-oct en la app', TODAY)).toBe(
      'Check-in: 3:00 PM | Check-out: 11:00 AM | ⚠️ Diferencia con Airbnb (8-oct): Salida 13-oct en Airbnb, 12-oct en la app',
    )
  })

  it('replaces an earlier mark instead of piling up', () => {
    const first = setDiffNote(BASE, 'uno', '2026-10-01')
    expect(setDiffNote(first, 'dos', TODAY)).toBe(`${BASE} | ⚠️ Diferencia con Airbnb (8-oct): dos`)
  })

  it('keeps the check-in and check-out times readable for the home and cleaning screens', () => {
    const notes = setDiffNote(BASE, 'Llegada 9-oct en Airbnb, 10-oct en la app', TODAY)
    expect(notes.match(/Check-out:\s*([^|]+)/i)?.[1].trim()).toBe('11:00 AM')
    expect(notes.match(/Check-in:\s*([^|]+)/i)?.[1].trim()).toBe('3:00 PM')
  })

  it('neutralizes a | inside the message', () => {
    const notes = setDiffNote(BASE, 'a | b', TODAY)
    expect(notes).toBe(`${BASE} | ⚠️ Diferencia con Airbnb (8-oct): a / b`)
    expect(clearDiffNote(notes)).toBe(BASE)
  })

  it('works on empty notes', () => {
    expect(setDiffNote('', 'x', TODAY)).toBe('⚠️ Diferencia con Airbnb (8-oct): x')
    expect(setDiffNote(null, 'x', TODAY)).toBe('⚠️ Diferencia con Airbnb (8-oct): x')
  })
})

describe('clearDiffNote', () => {
  it('gives back the original notes', () => {
    expect(clearDiffNote(setDiffNote(BASE, 'x', TODAY))).toBe(BASE)
    expect(clearDiffNote(setDiffNote('', 'x', TODAY))).toBe('')
  })

  it('removes a mark in the middle', () => {
    expect(clearDiffNote('A | ⚠️ Diferencia con Airbnb (1-oct): x | B')).toBe('A | B')
  })

  it('leaves the Gmail sync mark alone', () => {
    const gmail = `${BASE} | ⚠️ Fechas actualizadas — verificar en Airbnb`
    const marked = setDiffNote(gmail, 'x', TODAY)
    expect(marked).toContain('⚠️ Fechas actualizadas')
    expect(clearDiffNote(marked)).toBe(gmail)
  })

  it('does nothing when there is no mark', () => {
    expect(clearDiffNote(BASE)).toBe(BASE)
    expect(clearDiffNote(null)).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/notes.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/notes"`

- [ ] **Step 3: Write the implementation**

```ts
import { shortDate } from './dates'

/** Marca que deja la revisión con ChatGPT en las notas de una reserva. */
export const DIFF_TAG = '⚠️ Diferencia con Airbnb'

// The mark runs from its " | " separator up to the next " | " or the end. Reservation notes
// also carry "Check-in: 3:00 PM | Check-out: 11:00 AM", which the home and cleaning screens
// read with [^|]+ — so the mark itself must never contain "|".
const SEGMENT = new RegExp(String.raw`\s*\|?\s*${DIFF_TAG}[^|]*?(?=\s*\||$)`, 'g')

/** Quita la marca de diferencia (si está); el resto de las notas queda igual. */
export function clearDiffNote(notes: string | null): string {
  return (notes ?? '').replace(SEGMENT, '')
}

/** Reemplaza la marca de diferencia por una nueva con la fecha de hoy. */
export function setDiffNote(notes: string | null, message: string, today: string): string {
  const base = clearDiffNote(notes)
  const segment = `${DIFF_TAG} (${shortDate(today)}): ${message.replace(/\|/g, '/')}`
  return base ? `${base} | ${segment}` : segment
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/notes.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/notes.ts __tests__/lib/gpt-api/notes.test.ts
git commit -m "feat(gpt-api): nota de diferencia con Airbnb en las reservas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Comparación (`lib/gpt-api/compare.ts`)

**Files:**
- Create: `lib/gpt-api/compare.ts`
- Test: `__tests__/lib/gpt-api/compare.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { compareReservations, type AppReservation } from '@/lib/gpt-api/compare'
import type { AirbnbReservationInput } from '@/lib/gpt-api/validate'

const PROPS = [
  { id: 'p1001', name: 'Palmetto 1001' },
  { id: 'p708', name: 'Tocahagua 708' },
]

const appRow = (over: Partial<AppReservation> = {}): AppReservation => ({
  id: 'r1', airbnb_code: 'HMAAA111', guest_name: 'Laura Gómez', property_id: 'p1001',
  check_in: '2026-10-10', check_out: '2026-10-13', guests: 2,
  status: 'confirmed', source: 'airbnb', notes: '', ...over,
})

const bnb = (over: Partial<AirbnbReservationInput> = {}): AirbnbReservationInput => ({
  code: 'HMAAA111', guest_name: 'Laura Gómez', property: 'Palmetto 1001',
  check_in: '2026-10-10', check_out: '2026-10-13', guests: 2, status: 'confirmed', ...over,
})

const run = (items: AirbnbReservationInput[], rows: AppReservation[]) =>
  compareReservations({ from: '2026-10-08', to: '2026-11-07', dry_run: false, reservations: items }, rows, PROPS)

describe('compareReservations', () => {
  it('reports nothing when Airbnb and the app agree', () => {
    const r = run([bnb()], [appRow()])
    expect(r.differences).toEqual([])
    expect(r.matching_ids).toEqual(['r1'])
    expect(r.summary).toEqual({ airbnb: 1, app: 1, matching: 1, differences: 0, unmatched: 0 })
  })

  it('flags a changed check-out with a readable message', () => {
    const r = run([bnb()], [appRow({ check_out: '2026-10-12' })])
    expect(r.differences).toHaveLength(1)
    expect(r.differences[0]).toMatchObject({
      types: ['dates_differ'], code: 'HMAAA111', reservation_id: 'r1', property: 'Palmetto 1001',
      message: 'Salida 13-oct en Airbnb, 12-oct en la app',
    })
  })

  it('joins several differences of one booking in a single message', () => {
    const r = run([bnb({ check_in: '2026-10-09', guests: 3 })], [appRow()])
    expect(r.differences[0].types).toEqual(['dates_differ', 'guests_differ'])
    expect(r.differences[0].message).toBe('Llegada 9-oct en Airbnb, 10-oct en la app; 3 huéspedes en Airbnb, 2 en la app')
  })

  it('ignores the guest count when one side does not have it', () => {
    expect(run([bnb({ guests: null })], [appRow()]).differences).toEqual([])
    expect(run([bnb()], [appRow({ guests: null })]).differences).toEqual([])
  })

  it('flags a booking cancelled in Airbnb that is still confirmed in the app', () => {
    const r = run([bnb({ status: 'cancelled' })], [appRow()])
    expect(r.differences[0]).toMatchObject({
      types: ['cancelled_in_airbnb'], reservation_id: 'r1',
      message: 'Cancelada en Airbnb; en la app sigue confirmada',
    })
  })

  it('treats cancelled on both sides as matching', () => {
    const r = run([bnb({ status: 'cancelled' })], [appRow({ status: 'cancelled' })])
    expect(r.differences).toEqual([])
    expect(r.summary.matching).toBe(1)
  })

  it('reports a confirmed Airbnb booking missing from the app, with nothing to mark', () => {
    const r = run([bnb({ code: 'HMZZZ999' })], [])
    expect(r.differences[0]).toMatchObject({ types: ['missing_in_app'], reservation_id: null, app: null })
    expect(r.differences[0].message).toContain('sincronización de Gmail')
  })

  it('reports as missing when the app only has it cancelled', () => {
    const r = run([bnb()], [appRow({ status: 'cancelled' })])
    expect(r.differences[0]).toMatchObject({ types: ['missing_in_app'], reservation_id: null })
    expect(r.differences[0].message).toContain('figura cancelada')
  })

  it('is fine with a cancelled Airbnb booking that the app does not have', () => {
    expect(run([bnb({ code: 'HMZZZ999', status: 'cancelled' })], []).differences).toEqual([])
  })

  it('matches by first name, apartment and dates when the code is missing', () => {
    const r = run([bnb({ code: null, guest_name: 'Laura' })], [appRow()])
    expect(r.differences).toEqual([])
    expect(r.matching_ids).toEqual(['r1'])
  })

  it('matches names regardless of accents and case', () => {
    expect(run([bnb({ code: null, guest_name: 'laura gomez' })], [appRow()]).differences).toEqual([])
  })

  it('does not name-match a booking that has a different code', () => {
    const r = run([bnb({ code: 'HMZZZ999' })], [appRow()])
    expect(r.differences.map(d => d.types[0]).sort()).toEqual(['missing_in_app', 'not_in_airbnb_list'])
  })

  it('leaves ambiguous name matches unmatched and does not flag the candidates', () => {
    const rows = [
      appRow({ airbnb_code: null }),
      appRow({ id: 'r2', airbnb_code: null, check_in: '2026-10-11', check_out: '2026-10-14' }),
    ]
    const r = run([bnb({ code: null, guest_name: 'Laura' })], rows)
    expect(r.unmatched).toHaveLength(1)
    expect(r.unmatched[0].reason).toBe('Hay 2 reservas de Laura en Palmetto 1001 que se cruzan con esas fechas')
    expect(r.differences).toEqual([])
  })

  it('flags a different apartment when matched by code', () => {
    const r = run([bnb({ property: 'Tocahagua 708' })], [appRow()])
    expect(r.differences[0]).toMatchObject({
      types: ['property_differ'],
      message: 'En Airbnb está en Tocahagua 708, en la app en Palmetto 1001',
    })
  })

  it('flags app bookings in the range that Airbnb did not list', () => {
    const r = run([bnb()], [
      appRow(),
      appRow({ id: 'r2', airbnb_code: 'HMBBB222', guest_name: 'Pedro', check_in: '2026-10-20', check_out: '2026-10-22' }),
    ])
    expect(r.differences).toHaveLength(1)
    expect(r.differences[0]).toMatchObject({ types: ['not_in_airbnb_list'], reservation_id: 'r2', code: 'HMBBB222' })
    expect(r.summary.app).toBe(2)
  })

  it('never flags blocks, direct bookings or stays outside the range', () => {
    const rows = [
      appRow(),
      appRow({ id: 'b1', airbnb_code: null, status: 'blocked', check_in: '2026-10-20', check_out: '2026-10-25' }),
      appRow({ id: 'd1', airbnb_code: null, source: 'direct', check_in: '2026-10-26', check_out: '2026-10-28' }),
      appRow({ id: 'o1', airbnb_code: 'HMOLD000', check_in: '2026-10-05', check_out: '2026-10-08' }),
    ]
    expect(run([bnb()], rows).differences).toEqual([])
  })

  it('cannot match an unknown apartment without a code', () => {
    const r = run([bnb({ code: null, property: 'Casa Toro' })], [appRow()])
    expect(r.unmatched[0].reason).toBe('No reconozco el apartamento «Casa Toro»')
  })

  it('reports a code that comes twice in the list', () => {
    const r = run([bnb(), bnb()], [appRow()])
    expect(r.unmatched[0].reason).toBe('El código HMAAA111 vino repetido en la lista')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/compare.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/compare"`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Compara las reservas que ChatGPT leyó en Airbnb con las de la app. Pura: no toca la base.
 * Reglas en docs/superpowers/specs/2026-10-08-api-chatgpt-design.md §5.
 */
import { guestNameMatches } from '@/lib/gmail-sync'
import type { ReservationSource, ReservationStatus } from '@/lib/types'
import { shortDate } from './dates'
import { resolveProperty, type PropertyRef } from './properties'
import type { AirbnbReservationInput, CompareInput } from './validate'

export interface AppReservation {
  id: string
  airbnb_code: string | null
  guest_name: string
  property_id: string
  check_in: string
  check_out: string
  guests: number | null
  status: ReservationStatus
  source: ReservationSource
  notes: string | null
}

export type DiffType =
  | 'missing_in_app'
  | 'cancelled_in_airbnb'
  | 'dates_differ'
  | 'guests_differ'
  | 'property_differ'
  | 'not_in_airbnb_list'

export interface StaySnapshot {
  property: string | null
  check_in: string
  check_out: string
  guests: number | null
  status: string
}

export interface Difference {
  types: DiffType[]
  code: string | null
  guest_name: string
  property: string | null
  airbnb: StaySnapshot | null
  app: StaySnapshot | null
  message: string
  /** Reserva de la app donde va la nota; null cuando no hay reserva activa que marcar. */
  reservation_id: string | null
}

export interface Unmatched {
  input: AirbnbReservationInput
  reason: string
}

export interface CompareResult {
  summary: { airbnb: number; app: number; matching: number; differences: number; unmatched: number }
  differences: Difference[]
  unmatched: Unmatched[]
  /** Reservas de la app que coinciden con Airbnb: se les quita una nota de diferencia vieja. */
  matching_ids: string[]
}

type Stay = { check_in: string; check_out: string }

// Airbnb's list may carry the full name or only the first one, and so may the app.
const sameGuest = (a: string, b: string) => guestNameMatches(a, b) || guestNameMatches(b, a)
const overlaps = (a: Stay, b: Stay) => a.check_in < b.check_out && b.check_in < a.check_out
const normCode = (code: string | null) => (code ? code.replace(/\s+/g, '').toUpperCase() : null)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const span = (s: Stay) => `${shortDate(s.check_in)} a ${shortDate(s.check_out)}`

export function compareReservations(
  input: CompareInput,
  appRows: AppReservation[],
  properties: PropertyRef[],
): CompareResult {
  const nameOf = (id: string) => properties.find(p => p.id === id)?.name ?? null
  const snapshot = (r: AppReservation): StaySnapshot => ({
    property: nameOf(r.property_id), check_in: r.check_in, check_out: r.check_out, guests: r.guests, status: r.status,
  })

  // Blocks and direct bookings are reservations made outside Airbnb: they never show up there.
  const app = appRows.filter(r => r.source === 'airbnb' && r.status !== 'blocked')
  const byCode = new Map<string, AppReservation>()
  for (const r of app) {
    const code = normCode(r.airbnb_code)
    if (code) byCode.set(code, r)
  }

  const used = new Set<string>()        // app bookings already paired with an Airbnb one
  const ambiguous = new Set<string>()   // candidates of an unmatched entry: not "missing from Airbnb"
  const differences: Difference[] = []
  const unmatched: Unmatched[] = []
  const matchingIds: string[] = []
  let matching = 0

  for (const item of input.reservations) {
    const code = normCode(item.code)
    const property = resolveProperty(item.property, properties)
    const airbnb: StaySnapshot = {
      property: property?.name ?? item.property,
      check_in: item.check_in, check_out: item.check_out, guests: item.guests, status: item.status,
    }

    let match = code ? byCode.get(code) : undefined
    const matchedByCode = match !== undefined
    if (match && used.has(match.id)) {
      unmatched.push({ input: item, reason: `El código ${code} vino repetido en la lista` })
      continue
    }

    if (!match && property) {
      const candidates = app.filter(r =>
        !used.has(r.id) &&
        r.property_id === property.id &&
        (!code || !r.airbnb_code) &&      // a booking with another code is another booking
        sameGuest(r.guest_name, item.guest_name) &&
        overlaps(r, item))
      if (candidates.length > 1) {
        for (const c of candidates) ambiguous.add(c.id)
        unmatched.push({
          input: item,
          reason: `Hay ${candidates.length} reservas de ${item.guest_name} en ${property.name} que se cruzan con esas fechas`,
        })
        continue
      }
      match = candidates[0]
    } else if (!match && !code) {
      unmatched.push({ input: item, reason: `No reconozco el apartamento «${item.property}»` })
      continue
    }

    if (match) used.add(match.id)

    const report = (types: DiffType[], message: string, target: AppReservation | undefined) =>
      differences.push({
        types, code: code ?? normCode(match?.airbnb_code ?? null), guest_name: item.guest_name,
        property: property?.name ?? (match ? nameOf(match.property_id) : null),
        airbnb, app: match ? snapshot(match) : null, message,
        reservation_id: target?.id ?? null,
      })

    // Not active in the app (absent or cancelled there)
    if (!match || match.status === 'cancelled') {
      if (item.status === 'confirmed') {
        report(['missing_in_app'], match
          ? `Confirmada en Airbnb (${span(item)}) pero en la app figura cancelada`
          : `Confirmada en Airbnb (${span(item)}) pero no existe en la app; corre la sincronización de Gmail para importarla`,
          undefined)
      } else {
        matching++
        if (match) matchingIds.push(match.id)
      }
      continue
    }

    if (item.status === 'cancelled') {
      report(['cancelled_in_airbnb'], 'Cancelada en Airbnb; en la app sigue confirmada', match)
      continue
    }

    const types: DiffType[] = []
    const parts: string[] = []
    if (item.check_in !== match.check_in || item.check_out !== match.check_out) {
      types.push('dates_differ')
      if (item.check_in !== match.check_in) {
        parts.push(`llegada ${shortDate(item.check_in)} en Airbnb, ${shortDate(match.check_in)} en la app`)
      }
      if (item.check_out !== match.check_out) {
        parts.push(`salida ${shortDate(item.check_out)} en Airbnb, ${shortDate(match.check_out)} en la app`)
      }
    }
    if (item.guests != null && match.guests != null && item.guests !== match.guests) {
      types.push('guests_differ')
      parts.push(`${item.guests} huéspedes en Airbnb, ${match.guests} en la app`)
    }
    if (matchedByCode && property && property.id !== match.property_id) {
      types.push('property_differ')
      parts.push(`en Airbnb está en ${property.name}, en la app en ${nameOf(match.property_id) ?? 'otro apartamento'}`)
    }

    if (types.length === 0) {
      matching++
      matchingIds.push(match.id)
    } else {
      report(types, capitalize(parts.join('; ')), match)
    }
  }

  // Confirmed app bookings with nights inside the range that Airbnb's list didn't include.
  const inRange = app.filter(r => r.status === 'confirmed' && r.check_in <= input.to && r.check_out > input.from)
  for (const r of inRange) {
    if (used.has(r.id) || ambiguous.has(r.id)) continue
    differences.push({
      types: ['not_in_airbnb_list'], code: r.airbnb_code, guest_name: r.guest_name,
      property: nameOf(r.property_id), airbnb: null, app: snapshot(r),
      message: `No apareció en la lista de Airbnb (${span(r)}); verificar si se canceló o si faltó leerla`,
      reservation_id: r.id,
    })
  }

  return {
    summary: {
      airbnb: input.reservations.length,
      app: inRange.length,
      matching,
      differences: differences.length,
      unmatched: unmatched.length,
    },
    differences,
    unmatched,
    matching_ids: matchingIds,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/compare.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (18 tests) y tsc sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/compare.ts __tests__/lib/gpt-api/compare.test.ts
git commit -m "feat(gpt-api): comparar reservas de Airbnb con la app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Mantenimiento en la base (`lib/gpt-api/maintenance.ts`)

**Files:**
- Create: `lib/gpt-api/maintenance.ts`
- Test: `__tests__/lib/gpt-api/maintenance.test.ts`

- [ ] **Step 1: Write the failing test** (solo la parte pura; las consultas se prueban a mano en la Task 13)

```ts
import { describe, it, expect } from 'vitest'
import { appendMaintenanceNote } from '@/lib/gpt-api/maintenance'

describe('appendMaintenanceNote', () => {
  it('adds a dated ChatGPT line below the existing notes', () => {
    expect(appendMaintenanceNote('Creado por la rutina de reseñas.', 'Turge cambió el sifón', '2026-10-08'))
      .toBe('Creado por la rutina de reseñas.\n[8-oct · ChatGPT] Turge cambió el sifón')
  })

  it('starts the notes when there were none', () => {
    expect(appendMaintenanceNote('', 'Listo', '2026-10-08')).toBe('[8-oct · ChatGPT] Listo')
    expect(appendMaintenanceNote(null, 'Listo', '2026-10-08')).toBe('[8-oct · ChatGPT] Listo')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/maintenance.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/maintenance"`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Pendientes de mantenimiento para el API de ChatGPT: listar, crear (sin duplicar) y cambiar
 * estado. Escribe solo status, resolved_at, notes, cost, last_done y next_due; nunca borra.
 */
import { advanceNextDue } from '@/lib/maintenance-schedule'
import type { MaintenancePriority, MaintenanceStatus } from '@/lib/types'
import { shortDate } from './dates'
import type { Db } from './db'
import { normalizeText } from './properties'
import type { MaintenanceFilter, MaintenancePatch } from './validate'

const FIELDS =
  'id, title, description, priority, status, notes, cost, created_at, resolved_at, ' +
  'next_due, last_done, interval_months, property:properties(name)'

export interface MaintenanceOut {
  id: string
  property: string | null
  title: string
  description: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  notes: string
  cost: number | null
  created_at: string
  resolved_at: string | null
  next_due: string | null
  last_done: string | null
  interval_months: number | null
}

type Row = Omit<MaintenanceOut, 'property'> & { property: { name: string } | { name: string }[] | null }

function toOut({ property, ...rest }: Row): MaintenanceOut {
  const p = Array.isArray(property) ? property[0] : property
  return { ...rest, property: p?.name ?? null }
}

/** Agrega una línea "[8-oct · ChatGPT] …" al final de las notas, sin borrar lo que había. */
export function appendMaintenanceNote(notes: string | null, note: string, today: string): string {
  const line = `[${shortDate(today)} · ChatGPT] ${note}`
  return notes ? `${notes}\n${line}` : line
}

/** Los pendientes del API salen reportados por Diego, como los de la rutina de reseñas. */
async function diegoId(db: Db): Promise<string> {
  const { data, error } = await db
    .from('team_members').select('id').eq('name', 'Diego').eq('role', 'admin').single()
  if (error || !data) throw new Error(`No encontré a Diego en el equipo: ${error?.message ?? 'sin datos'}`)
  return data.id
}

export async function listMaintenance(
  db: Db,
  opts: { propertyId?: string; status: MaintenanceFilter },
): Promise<MaintenanceOut[]> {
  let query = db.from('maintenance').select(FIELDS).order('created_at', { ascending: false }).limit(100)
  query = opts.status === 'active' ? query.in('status', ['open', 'in_progress']) : query.eq('status', opts.status)
  if (opts.propertyId) query = query.eq('property_id', opts.propertyId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(toOut)
}

export async function createMaintenance(
  db: Db,
  input: { propertyId: string; title: string; description: string; priority: MaintenancePriority },
): Promise<{ created: boolean; issue: MaintenanceOut }> {
  const { data: open, error: openError } = await db
    .from('maintenance').select(FIELDS)
    .eq('property_id', input.propertyId).in('status', ['open', 'in_progress'])
  if (openError) throw new Error(openError.message)
  const same = ((open ?? []) as Row[]).find(r => normalizeText(r.title) === normalizeText(input.title))
  if (same) return { created: false, issue: toOut(same) }

  const { data, error } = await db
    .from('maintenance')
    .insert({
      property_id: input.propertyId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      reported_by: await diegoId(db),
      notes: 'Creado desde ChatGPT.',
    })
    .select(FIELDS)
    .single()
  if (error) throw new Error(error.message)
  return { created: true, issue: toOut(data as Row) }
}

/** null = no existe ese pendiente. */
export async function updateMaintenance(
  db: Db,
  id: string,
  patch: MaintenancePatch,
  today: string,
): Promise<{ issue: MaintenanceOut; scheduled_done: boolean } | null> {
  const { data: current, error: readError } = await db
    .from('maintenance').select('id, notes, interval_months').eq('id', id).maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!current) return null

  const update: Record<string, unknown> = {}
  let scheduledDone = false
  if (patch.status === 'resolved' && current.interval_months > 0) {
    // Recurring preventive: same as the app's "Hecho" button — it stays open and comes back
    // on its next date instead of disappearing.
    update.last_done = today
    update.next_due = advanceNextDue(today, current.interval_months)
    scheduledDone = true
  } else if (patch.status) {
    update.status = patch.status
    update.resolved_at = patch.status === 'resolved' ? new Date().toISOString() : null
  }
  if (patch.note) update.notes = appendMaintenanceNote(current.notes, patch.note, today)
  if (patch.cost !== undefined) update.cost = patch.cost

  const { data, error } = await db.from('maintenance').update(update).eq('id', id).select(FIELDS).single()
  if (error) throw new Error(error.message)
  return { issue: toOut(data as Row), scheduled_done: scheduledDone }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/maintenance.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (2 tests) y tsc sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/gpt-api/maintenance.ts __tests__/lib/gpt-api/maintenance.test.ts
git commit -m "feat(gpt-api): listar, crear y cambiar estado de pendientes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Reservas en la base (`lib/gpt-api/reservations.ts`) y utilidades HTTP (`lib/gpt-api/http.ts`)

**Files:**
- Create: `lib/gpt-api/reservations.ts`
- Create: `lib/gpt-api/http.ts`

Sin prueba unitaria propia: es acceso a la base y envoltorio HTTP; la lógica que deciden (comparación y notas) ya está probada en las Tasks 6 y 7. Se prueban a mano en la Task 13.

- [ ] **Step 1: Write `lib/gpt-api/reservations.ts`**

```ts
/**
 * Reservas para el API de ChatGPT. Nunca leen montos; la única escritura es la nota
 * "⚠️ Diferencia con Airbnb" en `notes`.
 */
import type { AppReservation, CompareResult } from './compare'
import { addDays } from './dates'
import type { Db } from './db'
import { clearDiffNote, setDiffNote } from './notes'
import type { Range } from './validate'

const FIELDS = 'id, airbnb_code, guest_name, property_id, check_in, check_out, guests, status, source, notes'

/** Reservas con noches dentro del rango (check_in <= to y check_out > from). */
export async function listReservations(db: Db, range: Range, propertyId?: string): Promise<AppReservation[]> {
  let query = db.from('reservations').select(FIELDS)
    .lte('check_in', range.to).gt('check_out', range.from).order('check_in')
  if (propertyId) query = query.eq('property_id', propertyId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as AppReservation[]
}

/**
 * Lo que la comparación necesita de la app: el rango con 30 días de margen a cada lado (por si
 * las fechas cambiaron mucho) más las reservas cuyo código vino en la lista de Airbnb.
 */
export async function loadForCompare(db: Db, range: Range, codes: string[]): Promise<AppReservation[]> {
  const rows = await listReservations(db, { from: addDays(range.from, -30), to: addDays(range.to, 30) })
  if (codes.length > 0) {
    const { data, error } = await db.from('reservations').select(FIELDS).in('airbnb_code', codes)
    if (error) throw new Error(error.message)
    const seen = new Set(rows.map(r => r.id))
    for (const r of (data ?? []) as AppReservation[]) if (!seen.has(r.id)) rows.push(r)
  }
  return rows
}

async function writeNotes(db: Db, id: string, notes: string): Promise<boolean> {
  const { error } = await db.from('reservations').update({ notes }).eq('id', id)
  if (error) console.error('[gpt-api] no pude guardar la nota de la reserva', id, error.message)
  return !error
}

/**
 * Deja la nota "⚠️ Diferencia con Airbnb" en cada reserva con diferencia y la quita de las que ya
 * coinciden. Solo escribe cuando la nota cambia. `noted` = reservas que quedaron marcadas.
 */
export async function applyDiffNotes(
  db: Db,
  rows: AppReservation[],
  result: CompareResult,
  today: string,
): Promise<{ noted: Set<string>; cleared: number }> {
  const notesById = new Map(rows.map(r => [r.id, r.notes ?? '']))
  const noted = new Set<string>()
  let cleared = 0

  for (const d of result.differences) {
    const before = d.reservation_id ? notesById.get(d.reservation_id) : undefined
    if (!d.reservation_id || before === undefined) continue
    const after = setDiffNote(before, d.message, today)
    if (after === before || await writeNotes(db, d.reservation_id, after)) noted.add(d.reservation_id)
  }
  for (const id of result.matching_ids) {
    const before = notesById.get(id)
    if (before === undefined) continue
    const after = clearDiffNote(before)
    if (after !== before && await writeNotes(db, id, after)) cleared++
  }
  return { noted, cleared }
}
```

- [ ] **Step 2: Write `lib/gpt-api/http.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { checkApiKey } from './auth'

export const jsonResponse = (data: unknown, status = 200) => NextResponse.json(data, { status })
export const errorResponse = (status: number, error: string) => NextResponse.json({ error }, { status })

/**
 * Corre el handler solo si la petición trae la clave del API. Un error inesperado sale como 500
 * con un mensaje en español; el detalle queda en los registros de Vercel.
 */
export async function withApiKey(req: NextRequest, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  const auth = checkApiKey(req.headers.get('authorization'), process.env.GPT_API_KEY)
  if (!auth.ok) return errorResponse(auth.status, auth.error)
  try {
    return await handler()
  } catch (err) {
    console.error('[gpt-api]', err instanceof Error ? err.message : err)
    return errorResponse(500, 'Error interno del servidor. El detalle quedó en los registros de Vercel.')
  }
}

/** Cuerpo JSON de la petición, o undefined si no es JSON válido (lo rechaza la validación). */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add lib/gpt-api/reservations.ts lib/gpt-api/http.ts
git commit -m "feat(gpt-api): lectura de reservas, notas de diferencia y utilidades HTTP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Rutas del API

**Files:**
- Create: `app/api/gpt/properties/route.ts`
- Create: `app/api/gpt/maintenance/route.ts`
- Create: `app/api/gpt/maintenance/[id]/route.ts`
- Create: `app/api/gpt/reservations/route.ts`
- Create: `app/api/gpt/reservations/compare/route.ts`

- [ ] **Step 1: Write `app/api/gpt/properties/route.ts`**

```ts
/** GET /api/gpt/properties — apartamentos activos con su nombre exacto (GPT "AirAdmin"). */
import type { NextRequest } from 'next/server'
import { serviceDb } from '@/lib/gpt-api/db'
import { jsonResponse, withApiKey } from '@/lib/gpt-api/http'
import { listProperties } from '@/lib/gpt-api/properties'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const properties = await listProperties(serviceDb(), { onlyActive: true })
    return jsonResponse({ properties })
  })
}
```

- [ ] **Step 2: Write `app/api/gpt/maintenance/route.ts`**

```ts
/**
 * /api/gpt/maintenance (GPT "AirAdmin")
 *  - GET  → pendientes, por apartamento y estado (por defecto abiertos + en progreso)
 *  - POST → crea un pendiente reportado por Diego, sin duplicar uno abierto con el mismo título
 */
import type { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, readJson, withApiKey } from '@/lib/gpt-api/http'
import { createMaintenance, listMaintenance } from '@/lib/gpt-api/maintenance'
import { listProperties, resolveProperty } from '@/lib/gpt-api/properties'
import { parseMaintenanceFilter, parseNewMaintenance } from '@/lib/gpt-api/validate'

const unknownProperty = (name: string) =>
  errorResponse(404, `No reconozco el apartamento «${name}». Consulta listProperties para ver los nombres.`)

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    const status = parseMaintenanceFilter(params.get('status'))
    if (!status.ok) return errorResponse(400, status.error)

    const db = serviceDb()
    const propertyName = params.get('property')
    let propertyId: string | undefined
    if (propertyName) {
      const property = resolveProperty(propertyName, await listProperties(db))
      if (!property) return unknownProperty(propertyName)
      propertyId = property.id
    }

    const issues = await listMaintenance(db, { propertyId, status: status.value })
    return jsonResponse({ count: issues.length, issues })
  })
}

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const input = parseNewMaintenance(await readJson(req))
    if (!input.ok) return errorResponse(400, input.error)

    const db = serviceDb()
    const property = resolveProperty(input.value.property, await listProperties(db))
    if (!property) return unknownProperty(input.value.property)

    const result = await createMaintenance(db, {
      propertyId: property.id,
      title: input.value.title,
      description: input.value.description,
      priority: input.value.priority,
    })
    if (result.created) {
      revalidatePath('/maintenance')
      revalidatePath('/')
    }
    return jsonResponse(result, result.created ? 201 : 200)
  })
}
```

- [ ] **Step 3: Write `app/api/gpt/maintenance/[id]/route.ts`**

```ts
/**
 * PATCH /api/gpt/maintenance/{id} — cambia estado, agrega una nota o registra el costo.
 * En preventivos recurrentes "resolved" equivale al botón "Hecho" de la app.
 */
import type { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, readJson, withApiKey } from '@/lib/gpt-api/http'
import { updateMaintenance } from '@/lib/gpt-api/maintenance'
import { isUuid, parseMaintenancePatch } from '@/lib/gpt-api/validate'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, async () => {
    const { id } = await ctx.params
    if (!isUuid(id)) return errorResponse(404, 'No existe ese pendiente.')
    const patch = parseMaintenancePatch(await readJson(req))
    if (!patch.ok) return errorResponse(400, patch.error)

    const result = await updateMaintenance(serviceDb(), id, patch.value, todayInBogota())
    if (!result) return errorResponse(404, 'No existe ese pendiente.')
    revalidatePath('/maintenance')
    revalidatePath('/')
    return jsonResponse(result)
  })
}
```

- [ ] **Step 4: Write `app/api/gpt/reservations/route.ts`**

```ts
/** GET /api/gpt/reservations — reservas de la app con noches en el rango. Nunca devuelve montos. */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, withApiKey } from '@/lib/gpt-api/http'
import { listProperties, resolveProperty } from '@/lib/gpt-api/properties'
import { listReservations } from '@/lib/gpt-api/reservations'
import { parseRange } from '@/lib/gpt-api/validate'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    const range = parseRange(params.get('from'), params.get('to'), todayInBogota())
    if (!range.ok) return errorResponse(400, range.error)

    const db = serviceDb()
    const properties = await listProperties(db)
    const propertyName = params.get('property')
    let propertyId: string | undefined
    if (propertyName) {
      const property = resolveProperty(propertyName, properties)
      if (!property) {
        return errorResponse(404, `No reconozco el apartamento «${propertyName}». Consulta listProperties para ver los nombres.`)
      }
      propertyId = property.id
    }

    const rows = await listReservations(db, range.value, propertyId)
    const nameOf = new Map(properties.map(p => [p.id, p.name]))
    return jsonResponse({
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
  })
}
```

- [ ] **Step 5: Write `app/api/gpt/reservations/compare/route.ts`**

```ts
/**
 * POST /api/gpt/reservations/compare — compara la lista que ChatGPT leyó en Airbnb con la app.
 * Devuelve las diferencias y deja (o quita) la nota "⚠️ Diferencia con Airbnb" en las reservas;
 * con dry_run=true solo informa. Nunca cambia fechas, huéspedes, tareas ni montos.
 */
import type { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { compareReservations } from '@/lib/gpt-api/compare'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, readJson, withApiKey } from '@/lib/gpt-api/http'
import { listProperties } from '@/lib/gpt-api/properties'
import { applyDiffNotes, loadForCompare } from '@/lib/gpt-api/reservations'
import { parseCompareBody } from '@/lib/gpt-api/validate'

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const input = parseCompareBody(await readJson(req))
    if (!input.ok) return errorResponse(400, input.error)
    const { from, to, dry_run, reservations } = input.value

    const db = serviceDb()
    const properties = await listProperties(db)
    const codes = reservations.flatMap(r => (r.code ? [r.code] : []))
    const rows = await loadForCompare(db, { from, to }, codes)
    const result = compareReservations(input.value, rows, properties)

    let noted = new Set<string>()
    let cleared = 0
    if (!dry_run) {
      ;({ noted, cleared } = await applyDiffNotes(db, rows, result, todayInBogota()))
      if (noted.size > 0 || cleared > 0) revalidatePath('/', 'layout')
    }

    return jsonResponse({
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
  })
}
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint app/api/gpt lib/gpt-api lib/maintenance-schedule.ts`
Expected: sin errores

- [ ] **Step 7: Commit**

```bash
git add app/api/gpt
git commit -m "feat(gpt-api): rutas de mantenimiento, reservas y comparación

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Esquema OpenAPI (`lib/gpt-api/openapi.ts` + ruta)

**Files:**
- Create: `lib/gpt-api/openapi.ts`
- Create: `app/api/gpt/openapi.json/route.ts`
- Test: `__tests__/lib/gpt-api/openapi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildOpenApi } from '@/lib/gpt-api/openapi'

const spec = buildOpenApi('https://diegoprueba.vercel.app')
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ path, method, op: op as { operationId: string; description: string } })))

describe('buildOpenApi', () => {
  it('points to the app and asks for the bearer key', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.servers).toEqual([{ url: 'https://diegoprueba.vercel.app' }])
    expect(spec.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' })
    expect(spec.security).toEqual([{ bearerAuth: [] }])
  })

  it('documents every route once, each with its own operationId', () => {
    expect(operations.map(o => `${o.method} ${o.path}`).sort()).toEqual([
      'get /api/gpt/maintenance',
      'get /api/gpt/properties',
      'get /api/gpt/reservations',
      'patch /api/gpt/maintenance/{id}',
      'post /api/gpt/maintenance',
      'post /api/gpt/reservations/compare',
    ])
    expect(new Set(operations.map(o => o.op.operationId)).size).toBe(operations.length)
  })

  it('keeps descriptions within the 300 characters GPT actions allow', () => {
    for (const { op } of operations) expect(op.description.length).toBeLessThanOrEqual(300)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/gpt-api/openapi.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/gpt-api/openapi"`

- [ ] **Step 3: Write `lib/gpt-api/openapi.ts`**

```ts
/**
 * Esquema OpenAPI 3.1 que se importa al crear el GPT "AirAdmin" (Acciones). El servidor sale del
 * dominio de la petición, así sirve igual en producción y en local. No lleva secretos.
 */
const json = (schema: object) => ({ 'application/json': { schema } })
const ok = (description: string, schema: object) => ({ description, content: json(schema) })
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const ERROR = { $ref: '#/components/responses/Error' }

const date = { type: 'string', format: 'date' }
const nullable = (type: string) => ({ type: [type, 'null'] })

export function buildOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AirAdmin para ChatGPT',
      version: '1.0.0',
      description: 'Pendientes de mantenimiento y revisión de reservas de los apartamentos Airbnb de Diego.',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/gpt/properties': {
        get: {
          operationId: 'listProperties',
          summary: 'Apartamentos',
          description: 'Lista los apartamentos activos con su nombre exacto en la app. Úsalo para traducir cualquier nombre que diga Diego antes de crear pendientes o comparar reservas.',
          responses: {
            '200': ok('Apartamentos', {
              type: 'object',
              properties: { properties: { type: 'array', items: ref('Property') } },
              required: ['properties'],
            }),
            '401': ERROR,
          },
        },
      },
      '/api/gpt/maintenance': {
        get: {
          operationId: 'listMaintenance',
          summary: 'Consultar pendientes',
          description: 'Pendientes de mantenimiento, más recientes primero (máx. 100). Por defecto solo abiertos y en progreso. Consúltalo antes de decir que algo está roto o arreglado.',
          parameters: [
            { name: 'property', in: 'query', required: false, description: 'Nombre del apartamento', schema: { type: 'string' } },
            {
              name: 'status', in: 'query', required: false, description: 'active = abiertos + en progreso',
              schema: { type: 'string', enum: ['active', 'open', 'in_progress', 'resolved'], default: 'active' },
            },
          ],
          responses: {
            '200': ok('Pendientes', {
              type: 'object',
              properties: { count: { type: 'integer' }, issues: { type: 'array', items: ref('MaintenanceIssue') } },
              required: ['count', 'issues'],
            }),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
        post: {
          operationId: 'createMaintenance',
          summary: 'Crear pendiente',
          description: 'Crea un pendiente reportado por Diego y sin asignar. Si ya hay uno abierto con el mismo título en ese apartamento, no duplica: devuelve created=false y el existente.',
          requestBody: { required: true, content: json(ref('NewMaintenance')) },
          responses: {
            '201': ok('Creado', ref('CreateMaintenanceResult')),
            '200': ok('Ya existía', ref('CreateMaintenanceResult')),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
      },
      '/api/gpt/maintenance/{id}': {
        patch: {
          operationId: 'updateMaintenance',
          summary: 'Cambiar estado de un pendiente',
          description: 'Cambia el estado, agrega una nota con fecha o registra el costo. En preventivos recurrentes, "resolved" no lo cierra: anota hoy como última vez y avanza la próxima fecha (scheduled_done=true).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('MaintenancePatch')) },
          responses: {
            '200': ok('Actualizado', {
              type: 'object',
              properties: { issue: ref('MaintenanceIssue'), scheduled_done: { type: 'boolean' } },
              required: ['issue', 'scheduled_done'],
            }),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
      },
      '/api/gpt/reservations': {
        get: {
          operationId: 'listReservations',
          summary: 'Reservas de la app',
          description: 'Reservas de la app con noches dentro del rango (por defecto, de hoy a 60 días; máximo 120). Incluye bloqueos y reservas directas. No trae montos.',
          parameters: [
            { name: 'from', in: 'query', required: false, schema: date },
            { name: 'to', in: 'query', required: false, schema: date },
            { name: 'property', in: 'query', required: false, description: 'Nombre del apartamento', schema: { type: 'string' } },
          ],
          responses: {
            '200': ok('Reservas', {
              type: 'object',
              properties: {
                from: date, to: date, count: { type: 'integer' },
                reservations: { type: 'array', items: ref('Reservation') },
              },
              required: ['from', 'to', 'count', 'reservations'],
            }),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
      },
      '/api/gpt/reservations/compare': {
        post: {
          operationId: 'compareReservations',
          summary: 'Comparar con Airbnb',
          description: 'Compara la lista leída en Airbnb con la app. Devuelve las diferencias y deja la nota "⚠️ Diferencia con Airbnb" en las reservas afectadas (no si dry_run=true). Nunca cambia fechas ni datos.',
          requestBody: { required: true, content: json(ref('CompareRequest')) },
          responses: { '200': ok('Resultado', ref('CompareResult')), '400': ERROR, '401': ERROR },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      responses: {
        Error: {
          description: 'Error con el motivo en español',
          content: json({ type: 'object', properties: { error: { type: 'string' } }, required: ['error'] }),
        },
      },
      schemas: {
        Property: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
        },
        MaintenanceIssue: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            property: nullable('string'),
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['urgent', 'normal', 'scheduled'] },
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
            notes: { type: 'string' },
            cost: nullable('number'),
            created_at: { type: 'string' },
            resolved_at: nullable('string'),
            next_due: nullable('string'),
            last_done: nullable('string'),
            interval_months: nullable('integer'),
          },
        },
        NewMaintenance: {
          type: 'object',
          properties: {
            property: { type: 'string', description: 'Nombre exacto del apartamento (listProperties)' },
            title: { type: 'string', maxLength: 120 },
            description: { type: 'string', maxLength: 1000 },
            priority: {
              type: 'string', enum: ['urgent', 'normal', 'scheduled'],
              description: 'urgent = afecta la estadía; normal = desgaste; scheduled = fotos o ficha',
            },
          },
          required: ['property', 'title', 'priority'],
        },
        CreateMaintenanceResult: {
          type: 'object',
          properties: { created: { type: 'boolean' }, issue: ref('MaintenanceIssue') },
          required: ['created', 'issue'],
        },
        MaintenancePatch: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
            note: { type: 'string', maxLength: 1000, description: 'Se agrega al final de las notas, con la fecha' },
            cost: { type: 'number', minimum: 0, description: 'Costo en pesos colombianos' },
          },
        },
        Reservation: {
          type: 'object',
          properties: {
            airbnb_code: nullable('string'),
            guest_name: { type: 'string' },
            property: nullable('string'),
            check_in: date,
            check_out: date,
            guests: nullable('integer'),
            status: { type: 'string', enum: ['confirmed', 'blocked', 'cancelled'] },
            source: { type: 'string', enum: ['airbnb', 'direct'] },
            notes: nullable('string'),
          },
        },
        AirbnbReservation: {
          type: 'object',
          properties: {
            code: { type: ['string', 'null'], description: 'Código de confirmación HM…' },
            guest_name: { type: 'string' },
            property: { type: 'string', description: 'Nombre del apartamento en la app' },
            check_in: date,
            check_out: date,
            guests: { type: ['integer', 'null'], minimum: 1 },
            status: { type: 'string', enum: ['confirmed', 'cancelled'], default: 'confirmed' },
          },
          required: ['guest_name', 'property', 'check_in', 'check_out'],
        },
        CompareRequest: {
          type: 'object',
          properties: {
            from: date,
            to: date,
            dry_run: { type: 'boolean', default: false, description: 'true = solo mirar, sin dejar notas en la app' },
            reservations: { type: 'array', items: ref('AirbnbReservation'), minItems: 1, maxItems: 300 },
          },
          required: ['from', 'to', 'reservations'],
        },
        Stay: {
          type: ['object', 'null'],
          properties: {
            property: nullable('string'), check_in: date, check_out: date,
            guests: nullable('integer'), status: { type: 'string' },
          },
        },
        Difference: {
          type: 'object',
          properties: {
            types: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['missing_in_app', 'cancelled_in_airbnb', 'dates_differ', 'guests_differ', 'property_differ', 'not_in_airbnb_list'],
              },
            },
            code: nullable('string'),
            guest_name: { type: 'string' },
            property: nullable('string'),
            airbnb: ref('Stay'),
            app: ref('Stay'),
            message: { type: 'string' },
            reservation_id: nullable('string'),
            noted: { type: 'boolean', description: 'true si quedó la nota en la reserva de la app' },
          },
        },
        CompareResult: {
          type: 'object',
          properties: {
            from: date,
            to: date,
            dry_run: { type: 'boolean' },
            summary: {
              type: 'object',
              properties: {
                airbnb: { type: 'integer' }, app: { type: 'integer' }, matching: { type: 'integer' },
                differences: { type: 'integer' }, unmatched: { type: 'integer' },
              },
            },
            differences: { type: 'array', items: ref('Difference') },
            unmatched: {
              type: 'array',
              items: {
                type: 'object',
                properties: { input: ref('AirbnbReservation'), reason: { type: 'string' } },
              },
            },
            notes_cleared: { type: 'integer' },
          },
        },
      },
    },
  }
}
```

- [ ] **Step 4: Write `app/api/gpt/openapi.json/route.ts`**

```ts
/** GET /api/gpt/openapi.json — esquema público para importar en el GPT (no lleva secretos). */
import { NextResponse, type NextRequest } from 'next/server'
import { buildOpenApi } from '@/lib/gpt-api/openapi'

export function GET(req: NextRequest) {
  return NextResponse.json(buildOpenApi(req.nextUrl.origin))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/gpt-api/openapi.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (3 tests) y tsc sin errores

- [ ] **Step 6: Commit**

```bash
git add lib/gpt-api/openapi.ts app/api/gpt/openapi.json __tests__/lib/gpt-api/openapi.test.ts
git commit -m "feat(gpt-api): esquema OpenAPI para el GPT AirAdmin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Guía para Diego (`docs/chatgpt-airadmin.md`)

**Files:**
- Create: `docs/chatgpt-airadmin.md`

- [ ] **Step 1: Write the guide**

````markdown
# ChatGPT ↔ AirAdmin

Cómo conectar tu GPT "AirAdmin" a la app para manejar mantenimiento y revisar que las reservas
de Airbnb coincidan con la app. Diseño: `docs/superpowers/specs/2026-10-08-api-chatgpt-design.md`.

## 1. Poner la clave en Vercel (una sola vez)

1. Vercel → proyecto de la app → **Settings → Environment Variables**.
2. Nombre `GPT_API_KEY`, valor = la clave que te pasó Claude, entorno **Production**. Guardar.
3. **Deployments** → último deploy de producción → **⋯ → Redeploy** (la variable nueva solo se lee al desplegar).
4. Comprobar: abrir `https://diegoprueba.vercel.app/api/gpt/properties` en el navegador debe responder
   `{"error":"Clave del API inválida o ausente."}` (401). Si dice "no está configurado", falta el paso 3.

## 2. Crear el GPT (una sola vez)

1. ChatGPT → **GPT** → **Crear** → pestaña **Configurar**.
2. Nombre: `AirAdmin`. Descripción: `Mantenimiento y revisión de reservas de mis apartamentos`.
3. **Instrucciones**: pegar el bloque de la sección 3.
4. **Funcionalidades**: desmarcar todo (no necesita búsqueda web, imágenes ni código).
5. **Acciones → Crear nueva acción**:
   - **Importar desde URL**: `https://diegoprueba.vercel.app/api/gpt/openapi.json`
   - **Autenticación**: Clave de API → Tipo de autenticación **Bearer** → pegar la clave.
   - **Política de privacidad**: `https://diegoprueba.vercel.app` (ChatGPT pide una URL; el GPT es privado).
6. **Crear** → visibilidad **Solo yo**. No publicarlo en la tienda de GPT.

Si un día cambias la clave: cámbiala en Vercel (y redeploy) y en la acción del GPT. La vieja deja de servir.

## 3. Instrucciones del GPT (pegar tal cual)

```
Eres AirAdmin, el asistente de Diego para sus apartamentos de Airbnb en Cartagena. Habla siempre en español.

APARTAMENTOS
- Usa siempre los nombres exactos que devuelve listProperties. Si Diego nombra un apartamento de otra forma (título de Airbnb, edificio), tradúcelo a ese nombre; si dudas, pregúntale.

MANTENIMIENTO
- Antes de crear un pendiente, consulta los abiertos de ese apartamento con listMaintenance para no repetir.
- Prioridad: urgent = afecta la estadía (bichos, aire, agua, olor, seguridad, electricidad); normal = desgaste (lencería, pintura, cajones, puertas, muebles); scheduled = fotos o ficha.
- No cargues quejas de ubicación (ruido de la calle) ni cosas que ya están arregladas.
- Antes de crear un pendiente o cambiar su estado, muéstrale a Diego exactamente qué vas a hacer y espera su "sí".
- Antes de decir que algo está roto o arreglado, consulta su estado en la app.
- Si marcas "resolved" un preventivo recurrente (fumigación, aires), la app no lo cierra: anota hoy como última vez y avanza la próxima fecha. Explícaselo así a Diego con la nueva fecha.

REVISIÓN DE RESERVAS
- Diego te pega la lista que sacó de Airbnb con el modo agente. Conviértela a compareReservations: from y to (AAAA-MM-DD) y una entrada por reserva con code (HM…), guest_name, property (nombre de la app), check_in, check_out, guests y status (confirmed o cancelled).
- Si la lista no trae el año, usa el que corresponda a fechas próximas a hoy.
- Si Diego dice "solo mirar", envía dry_run: true (no deja notas en la app).
- Muestra el resultado en una tabla: apartamento, huésped, código y qué difiere. Después, lo que no se pudo emparejar y por qué.
- missing_in_app: sugiere correr la sincronización de Gmail en la app (Ajustes → Gmail).
- not_in_airbnb_list: puede ser que el agente no la haya leído; pide verificarla en Airbnb antes de concluir que se canceló.
- Nunca digas que corregiste reservas: el API solo deja la nota "⚠️ Diferencia con Airbnb" en la reserva de la app.

REGLAS
- Nunca inventes arreglos, fechas ni datos. Si algo no está en la app, dilo.
- Si una acción responde con error, explícale el mensaje a Diego en palabras simples.
```

## 4. Revisar reservas (cada vez)

**Paso A — en ChatGPT, modo agente** (no en el GPT): pegar este texto, cambiando las fechas.

```
Entra a Airbnb (airbnb.com.co) con mi sesión → modo anfitrión → Reservaciones. Revisa todas las
reservas que tengan noches entre el 2026-10-08 y el 2026-12-07, incluidas las que están en curso
y las canceladas de ese rango. Recorre todas las pestañas (próximas, en curso, canceladas) y todas
las páginas.

Solo lee: no escribas mensajes, no aceptes ni cambies nada.

Devuélveme UNA tabla en texto plano, una fila por reserva, con estas columnas separadas por punto y coma:
código;huésped;anuncio;llegada (AAAA-MM-DD);salida (AAAA-MM-DD);huéspedes;estado (confirmada/cancelada)

Al final escribe cuántas reservas listaste y si alguna página no cargó.
```

**Paso B — en el GPT AirAdmin**: «Compara estas reservas del 2026-10-08 al 2026-12-07:» y pegar la tabla.

El GPT responde con las diferencias. Las reservas con diferencia quedan con la nota
`⚠️ Diferencia con Airbnb (fecha): …` en la app; cuando vuelvan a coincidir, la nota se borra sola
en la siguiente revisión. También la puedes borrar a mano en el formulario de la reserva.

## 5. Mantenimiento (cada vez)

Directo en el GPT AirAdmin, por ejemplo:
- «¿Qué pendientes abiertos tiene Palmetto 1001?»
- «Carga en Tocahagua 1208: la puerta del balcón está dura, prioridad normal.»
- «Ya se arregló el desagüe de Palmetto; costó 80.000. Ciérralo.»
- «Ya se fumigó Conquistador hoy.» (preventivo: avanza la próxima fecha)

## Qué puede y qué no puede hacer

| Puede | No puede |
|---|---|
| Ver apartamentos, pendientes y reservas (sin montos) | Ver códigos de acceso, montos o correos |
| Crear pendientes (sin duplicar) | Borrar nada |
| Cambiar estado, agregar notas y costo a pendientes | Reasignar pendientes |
| Dejar o quitar la nota de diferencia en reservas | Cambiar fechas, huéspedes, tareas o montos de reservas |
````

- [ ] **Step 2: Commit**

```bash
git add docs/chatgpt-airadmin.md
git commit -m "docs: guía para conectar el GPT AirAdmin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Verificación completa

**Files:** ninguno nuevo.

- [ ] **Step 1: Pruebas, lint y build**

Run: `npx vitest run && npm run lint && npm run build`
Expected: todas las pruebas nuevas pasan; la única falla permitida es la que ya fallaba en `main`
(`gmail-sync.test.ts › parses "sept" in the HTML short-date format`). Lint sin errores nuevos. Build OK
y en la lista de rutas aparecen `/api/gpt/maintenance`, `/api/gpt/maintenance/[id]`,
`/api/gpt/openapi.json`, `/api/gpt/properties`, `/api/gpt/reservations`, `/api/gpt/reservations/compare`.

- [ ] **Step 2: Levantar la app local con una clave de prueba**

El worktree no tiene `.env.local`: enlazar el del checkout principal (no se copia ni se modifica).

```bash
ln -s "/Users/diegovalencia/Dropbox/Claude Code/AIRBNB/.env.local" .env.local
GPT_API_KEY="local-test-key-0123456789abcdefghijklmnop" npm run dev
```

(en segundo plano; espera a "Ready" en el puerto 4000)

> ⚠️ `.env.local` apunta a la base de Supabase real. Las pruebas de abajo solo LEEN o usan
> `dry_run`, salvo donde se indica. No crear ni cambiar pendientes reales sin el "sí" de Diego.

- [ ] **Step 3: Probar la clave y las lecturas**

```bash
K="local-test-key-0123456789abcdefghijklmnop"
curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/api/gpt/properties                       # 401
curl -s -H "Authorization: Bearer $K" localhost:4000/api/gpt/properties                          # lista de apartamentos, sin access_code
curl -s -H "Authorization: Bearer $K" "localhost:4000/api/gpt/maintenance?property=Palmetto%201001"  # pendientes activos
curl -s -H "Authorization: Bearer $K" "localhost:4000/api/gpt/reservations?from=2026-10-08&to=2026-11-07" | head -c 800  # sin "amount"
curl -s localhost:4000/api/gpt/openapi.json | head -c 300                                       # público, servers = http://localhost:4000
```

Expected: 401 sin clave; con clave, JSON con datos. Revisar que ninguna respuesta tenga `access_code` ni `amount`.

- [ ] **Step 4: Probar validaciones (no escriben)**

```bash
curl -s -X POST -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"property":"Palmetto 1001","title":"x","priority":"alta"}' localhost:4000/api/gpt/maintenance        # 400 priority
curl -s -X PATCH -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"status":"resolved"}' localhost:4000/api/gpt/maintenance/00000000-0000-4000-8000-000000000000         # 404
curl -s -X POST -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"from":"2026-10-08","to":"2026-11-07","reservations":[]}' localhost:4000/api/gpt/reservations/compare  # 400 lista vacía
```

- [ ] **Step 5: Comparación en modo "solo mirar"**

Tomar 2 reservas reales de la respuesta del Step 3 y mandarlas a `compare` con `dry_run: true`,
una igual y otra con la salida cambiada a propósito:

```bash
curl -s -X POST -H "Authorization: Bearer $K" -H "Content-Type: application/json" -d '{
  "from":"2026-10-08","to":"2026-11-07","dry_run":true,
  "reservations":[
    {"code":"<CODIGO_1>","guest_name":"<HUESPED_1>","property":"<APTO_1>","check_in":"<IN_1>","check_out":"<OUT_1>"},
    {"code":"<CODIGO_2>","guest_name":"<HUESPED_2>","property":"<APTO_2>","check_in":"<IN_2>","check_out":"<OUT_2 + 1 día>"}
  ]}' localhost:4000/api/gpt/reservations/compare
```

(los `<…>` se llenan con los valores reales del Step 3 al ejecutar)

Expected: `dry_run: true`; la segunda sale como `dates_differ` con `noted: false`; el resto de reservas del
rango salen como `not_in_airbnb_list` (normal: no se mandaron); `notes_cleared: 0`. Confirmar en la base que
ninguna reserva cambió sus notas.

- [ ] **Step 6: Apagar el servidor y quitar el enlace**

```bash
rm .env.local
```

(y detener el `npm run dev` en segundo plano)

---

### Task 14: PR

- [ ] **Step 1: Generar la clave de producción** (se le pasa a Diego, no se guarda en el repo)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- [ ] **Step 2: Push y PR con la cuenta `info-softop`**

```bash
gh auth status   # cuenta activa: info-softop
git push -u origin claude/api-chatgpt-maintenance-f0edba
gh pr create --base main --title "feat: API para ChatGPT (mantenimiento y revisión de reservas)" --body "<resumen en español + checklist de pasos de Diego + '🤖 Generated with [Claude Code](https://claude.com/claude-code)'>"
```

- [ ] **Step 3:** Revisar el estado del PR con las herramientas `ccd_pr` (get_status / bind_pr) y avisar a Diego:
  la clave, los pasos de Vercel y de la guía `docs/chatgpt-airadmin.md`.
