# MCP de AirAdmin: reservas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herramientas MCP `create_reservation`, `update_reservation`, `cancel_reservation`, y `list_reservations` con `id` y `amount`.

**Architecture:** Lógica nueva en `lib/gpt-api/reservation-writes.ts` (puras + DB con el cliente de servicio) y validación en `validate.ts`; `service.ts` la orquesta; `lib/mcp/tools.ts` registra las herramientas. Tareas con `lib/turnover-tasks.ts` (las mismas de la sincronización).

**Tech Stack:** Next.js 16.2, Supabase JS 2, `mcp-handler` 2.3, zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-11-mcp-reservas-design.md`

**Convenciones:** pruebas primero (`npx vitest run <archivo>` debe fallar antes de implementar); commits con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` con rutas exactas.

---

### Task 1: Validación (`lib/gpt-api/validate.ts`)

**Files:** Modify `lib/gpt-api/validate.ts` · Test `__tests__/lib/gpt-api/validate.test.ts`

- [ ] **Step 1: Append failing tests** to `__tests__/lib/gpt-api/validate.test.ts` (and add `checkStay, parseNewReservation, parseReservationPatch, parseReservationId` to its import list):

<!-- file-append: __tests__/lib/gpt-api/validate.test.ts -->
```ts

const ID = '2be6deec-8061-453e-b1ae-ce0bd177fadd'
const direct = { property: 'Palmetto 1001', source: 'direct', guest_name: 'Carlos Ruiz', check_in: '2026-10-20', check_out: '2026-10-23' }

describe('checkStay', () => {
  it('accepts a real stay and rejects backwards or too-long ones', () => {
    expect(checkStay('2026-10-20', '2026-10-23')).toEqual({ ok: true, value: { check_in: '2026-10-20', check_out: '2026-10-23' } })
    expect(checkStay('2026-10-23', '2026-10-20')).toEqual({ ok: false, error: '"check_out" debe ser posterior a "check_in".' })
    expect(checkStay('2026-10-20', '2027-02-18').ok).toBe(false)
    expect(checkStay('2026-02-30', '2026-03-02').ok).toBe(false)
  })
})

describe('parseNewReservation', () => {
  it('fills defaults for a direct booking and ignores a code there', () => {
    expect(parseNewReservation({ ...direct, code: 'HMABC12345' })).toEqual({
      ok: true,
      value: { ...direct, guests: null, amount: 0, code: null, note: '' },
    })
  })

  it('requires and normalizes the Airbnb code', () => {
    expect(parseNewReservation({ ...direct, source: 'airbnb' })).toEqual({
      ok: false, error: 'Las reservas de Airbnb necesitan el código de confirmación HM… en "code".',
    })
    const r = parseNewReservation({ ...direct, source: 'airbnb', code: ' hmabc 12345 ', guests: 2, amount: 850000, note: 'Pagó por Nequi' })
    expect(r.ok && r.value).toMatchObject({ code: 'HMABC12345', guests: 2, amount: 850000, note: 'Pagó por Nequi' })
    expect(parseNewReservation({ ...direct, source: 'airbnb', code: 'HM-1' }).ok).toBe(false)
  })

  it('rejects bad sources, guests and amounts', () => {
    expect(parseNewReservation({ ...direct, source: 'booking' })).toEqual({ ok: false, error: '"source" debe ser "direct" o "airbnb".' })
    expect(parseNewReservation({ ...direct, guests: 0 }).ok).toBe(false)
    expect(parseNewReservation({ ...direct, amount: -5 }).ok).toBe(false)
    expect(parseNewReservation({ ...direct, guest_name: ' ' })).toEqual({ ok: false, error: 'Falta "guest_name".' })
  })
})

describe('parseReservationPatch', () => {
  it('keeps only the fields sent', () => {
    expect(parseReservationPatch({ id: ID, check_out: '2026-10-24', amount: 900000 })).toEqual({
      ok: true, value: { id: ID, check_out: '2026-10-24', amount: 900000 },
    })
    expect(parseReservationPatch({ id: ID, guests: null })).toEqual({ ok: true, value: { id: ID, guests: null } })
  })

  it('needs a valid id and at least one change', () => {
    expect(parseReservationPatch({ id: 'x', amount: 1 })).toEqual({ ok: false, error: '"id" debe ser el id de la reserva (de list_reservations).' })
    expect(parseReservationPatch({ id: ID })).toEqual({
      ok: false, error: 'Envía al menos un cambio: guest_name, guests, check_in, check_out, amount o note.',
    })
    expect(parseReservationPatch({ id: ID, check_in: '20-10-2026' }).ok).toBe(false)
  })
})

describe('parseReservationId', () => {
  it('reads the reservation id', () => {
    expect(parseReservationId({ id: ID })).toEqual({ ok: true, value: ID })
    expect(parseReservationId({}).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/gpt-api/validate.test.ts` → FAIL (funciones no exportadas)

- [ ] **Step 3: Implement** in `lib/gpt-api/validate.ts`:
  - import: `import type { MaintenancePriority, MaintenanceStatus, ReservationSource } from '@/lib/types'`
  - `LIMITS`: add `stayNights: 120,` and `amount: 1_000_000_000,`
  - append:

<!-- file-append: lib/gpt-api/validate.ts -->
```ts

const RESERVATION_CODE = /^[A-Z0-9]{8,12}$/

export interface NewReservationInput {
  property: string
  source: ReservationSource
  guest_name: string
  check_in: string
  check_out: string
  guests: number | null
  amount: number
  code: string | null
  note: string
}

/** Cambios a una reserva: solo los campos enviados. */
export interface ReservationPatch {
  id: string
  guest_name?: string
  guests?: number | null
  check_in?: string
  check_out?: string
  amount?: number
  note?: string
}

/** Llegada y salida reales, salida después de la llegada, máximo 120 noches. */
export function checkStay(checkIn: unknown, checkOut: unknown): Parsed<{ check_in: string; check_out: string }> {
  if (!isIsoDate(checkIn)) return fail('"check_in" debe ser una fecha AAAA-MM-DD.')
  if (!isIsoDate(checkOut)) return fail('"check_out" debe ser una fecha AAAA-MM-DD.')
  if (checkOut <= checkIn) return fail('"check_out" debe ser posterior a "check_in".')
  if (daysBetween(checkIn, checkOut) > LIMITS.stayNights) return fail(`Máximo ${LIMITS.stayNights} noches por reserva.`)
  return ok({ check_in: checkIn, check_out: checkOut })
}

function parseGuestCount(v: unknown): Parsed<number | null> {
  if (v === undefined || v === null) return ok(null)
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > LIMITS.guests) {
    return fail(`"guests" debe ser un entero entre 1 y ${LIMITS.guests}.`)
  }
  return ok(v)
}

function parseAmount(v: unknown): Parsed<number> {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > LIMITS.amount) {
    return fail('"amount" debe ser un número mayor o igual a 0 (pesos colombianos).')
  }
  return ok(Math.round(v * 100) / 100)
}

const reservationIdError = '"id" debe ser el id de la reserva (de list_reservations).'

export function parseNewReservation(body: unknown): Parsed<NewReservationInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const property = text(body.property, 'property', LIMITS.name, true)
  if (!property.ok) return property
  const source = body.source
  if (!oneOf(source, ['direct', 'airbnb'] as const)) return fail('"source" debe ser "direct" o "airbnb".')
  const guest = text(body.guest_name, 'guest_name', LIMITS.name, true)
  if (!guest.ok) return guest
  const stay = checkStay(body.check_in, body.check_out)
  if (!stay.ok) return stay
  const guests = parseGuestCount(body.guests)
  if (!guests.ok) return guests
  const amount = body.amount === undefined || body.amount === null ? ok(0) : parseAmount(body.amount)
  if (!amount.ok) return amount
  const rawCode = text(body.code, 'code', LIMITS.code, false)
  if (!rawCode.ok) return rawCode
  const code = rawCode.value.replace(/\s+/g, '').toUpperCase() || null
  if (source === 'airbnb' && !code) return fail('Las reservas de Airbnb necesitan el código de confirmación HM… en "code".')
  if (source === 'airbnb' && code && !RESERVATION_CODE.test(code)) {
    return fail('"code" debe ser el código de Airbnb (8 a 12 letras y números).')
  }
  const note = text(body.note, 'note', LIMITS.text, false)
  if (!note.ok) return note
  return ok({
    property: property.value,
    source,
    guest_name: guest.value,
    ...stay.value,
    guests: guests.value,
    amount: amount.value,
    code: source === 'airbnb' ? code : null,
    note: note.value,
  })
}

export function parseReservationPatch(body: unknown): Parsed<ReservationPatch> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  const id = body.id
  if (typeof id !== 'string' || !isUuid(id)) return fail(reservationIdError)
  const patch: ReservationPatch = { id }
  if (body.guest_name !== undefined) {
    const guest = text(body.guest_name, 'guest_name', LIMITS.name, true)
    if (!guest.ok) return guest
    patch.guest_name = guest.value
  }
  if (body.guests !== undefined) {
    const guests = parseGuestCount(body.guests)
    if (!guests.ok) return guests
    patch.guests = guests.value
  }
  for (const field of ['check_in', 'check_out'] as const) {
    const value = body[field]
    if (value === undefined) continue
    if (!isIsoDate(value)) return fail(`"${field}" debe ser una fecha AAAA-MM-DD.`)
    patch[field] = value
  }
  if (body.amount !== undefined) {
    const amount = parseAmount(body.amount)
    if (!amount.ok) return amount
    patch.amount = amount.value
  }
  if (body.note !== undefined) {
    const note = text(body.note, 'note', LIMITS.text, true)
    if (!note.ok) return note
    patch.note = note.value
  }
  if (Object.keys(patch).length === 1) {
    return fail('Envía al menos un cambio: guest_name, guests, check_in, check_out, amount o note.')
  }
  return ok(patch)
}

export function parseReservationId(body: unknown): Parsed<string> {
  if (!isRecord(body)) return fail(reservationIdError)
  const id = body.id
  if (typeof id !== 'string' || !isUuid(id)) return fail(reservationIdError)
  return ok(id)
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/gpt-api/validate.test.ts && npx tsc --noEmit -p tsconfig.json` → PASS
- [ ] **Step 5: Commit** `feat(mcp): validación para crear, modificar y cancelar reservas`

---

### Task 2: Escrituras de reservas (`lib/gpt-api/reservation-writes.ts`)

**Files:** Create `lib/gpt-api/reservation-writes.ts` · Test `__tests__/lib/gpt-api/reservation-writes.test.ts`

- [ ] **Step 1: Write the failing test**

<!-- file: __tests__/lib/gpt-api/reservation-writes.test.ts -->
```ts
import { describe, it, expect } from 'vitest'
import {
  staysOverlap, appendReservationNote, creationNotes, conflictMessage, toReservationOut, type ReservationRow,
} from '@/lib/gpt-api/reservation-writes'

const row = (over: Partial<ReservationRow> = {}): ReservationRow => ({
  id: 'r1', property_id: 'p1', source: 'direct', airbnb_code: null, guest_name: 'Laura Gómez',
  check_in: '2026-10-20', check_out: '2026-10-23', guests: 2, amount: 850000,
  notes: 'Check-in: 3pm | Check-out: 12pm', status: 'confirmed', ...over,
})

describe('staysOverlap', () => {
  it('detects stays that share a night', () => {
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-22', check_out: '2026-10-25' })).toBe(true)
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-18', check_out: '2026-10-26' })).toBe(true)
  })

  it('lets one guest leave the day the next one arrives', () => {
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-23', check_out: '2026-10-25' })).toBe(false)
    expect(staysOverlap({ check_in: '2026-10-20', check_out: '2026-10-23' }, { check_in: '2026-10-17', check_out: '2026-10-20' })).toBe(false)
  })
})

describe('appendReservationNote', () => {
  it('adds at the end without touching the check-in/check-out times', () => {
    expect(appendReservationNote('Check-in: 3pm | Check-out: 12pm', 'Llega con mascota')).toBe('Check-in: 3pm | Check-out: 12pm | Llega con mascota')
    expect(appendReservationNote('', 'Pagó')).toBe('Pagó')
    expect(appendReservationNote(null, 'Pagó')).toBe('Pagó')
  })

  it('neutralizes "|" and ignores empty notes', () => {
    expect(appendReservationNote('A', 'x | y')).toBe('A | x / y')
    expect(appendReservationNote('A', '   ')).toBe('A')
  })
})

describe('creationNotes', () => {
  it('says who created it from ChatGPT and when', () => {
    expect(creationNotes('Diego', '2026-10-11', '')).toBe('Creada desde ChatGPT por Diego (11-oct)')
    expect(creationNotes('Diego', '2026-10-11', 'Pagó 50%')).toBe('Creada desde ChatGPT por Diego (11-oct) | Pagó 50%')
  })
})

describe('conflictMessage', () => {
  it('names who is already there', () => {
    expect(conflictMessage('Palmetto 1001', [row(), row({ guest_name: 'Pedro', check_in: '2026-10-23', check_out: '2026-10-25' })]))
      .toBe('Palmetto 1001 ya está ocupado en esas fechas: Laura Gómez (20-oct a 23-oct), Pedro (23-oct a 25-oct). No creo ni muevo reservas que se crucen.')
  })
})

describe('toReservationOut', () => {
  it('returns the reservation with the apartment name and a numeric amount', () => {
    expect(toReservationOut(row({ amount: '850000.00' as unknown as number }), 'Palmetto 1001')).toEqual({
      id: 'r1', airbnb_code: null, source: 'direct', guest_name: 'Laura Gómez', property: 'Palmetto 1001',
      check_in: '2026-10-20', check_out: '2026-10-23', guests: 2, amount: 850000, status: 'confirmed',
      notes: 'Check-in: 3pm | Check-out: 12pm',
    })
  })
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/gpt-api/reservation-writes.test.ts` → FAIL (no resuelve el import)

- [ ] **Step 3: Implement**

<!-- file: lib/gpt-api/reservation-writes.ts -->
```ts
/**
 * Crear, modificar y cancelar reservas desde el MCP, con las mismas reglas que la app y la
 * sincronización de Gmail: tareas de lib/turnover-tasks.ts, sin dobles reservas en un
 * apartamento, notas que solo se agregan y "borrar" = cancelar (así la sincronización no la
 * vuelve a importar).
 */
import { cleaningTaskFor, missingTurnoverTasks, preparationTaskFor } from '@/lib/turnover-tasks'
import type { ReservationSource, ReservationStatus } from '@/lib/types'
import { shortDate } from './dates'
import type { Db } from './db'

export interface ReservationRow {
  id: string
  property_id: string
  source: ReservationSource
  airbnb_code: string | null
  guest_name: string
  check_in: string
  check_out: string
  guests: number | null
  amount: number
  notes: string | null
  status: ReservationStatus
}

export interface ReservationOut {
  id: string
  airbnb_code: string | null
  source: string
  guest_name: string
  property: string
  check_in: string
  check_out: string
  guests: number | null
  amount: number
  status: string
  notes: string | null
}

type Stay = { check_in: string; check_out: string }

const FIELDS = 'id, property_id, source, airbnb_code, guest_name, check_in, check_out, guests, amount, notes, status'

/** ¿Se cruzan dos estadías? Salir y llegar el mismo día no choca. */
export function staysOverlap(a: Stay, b: Stay): boolean {
  return a.check_in < b.check_out && b.check_in < a.check_out
}

// Notes never carry "|": it separates the "Check-in: … | Check-out: …" times the home and
// cleaning screens read from the reservation.
const clean = (s: string) => s.replace(/\|/g, '/').trim()

/** Agrega una nota al final de las notas de la reserva, sin tocar lo que había. */
export function appendReservationNote(notes: string | null, note: string): string {
  const text = clean(note)
  if (!text) return notes ?? ''
  return notes ? `${notes} | ${text}` : text
}

/** Notas iniciales de una reserva creada desde ChatGPT. */
export function creationNotes(createdBy: string, today: string, note: string): string {
  return appendReservationNote(`Creada desde ChatGPT por ${clean(createdBy)} (${shortDate(today)})`, note)
}

export function conflictMessage(property: string, conflicts: (Stay & { guest_name: string })[]): string {
  const list = conflicts
    .map(c => `${c.guest_name} (${shortDate(c.check_in)} a ${shortDate(c.check_out)})`)
    .join(', ')
  return `${property} ya está ocupado en esas fechas: ${list}. No creo ni muevo reservas que se crucen.`
}

export function toReservationOut(r: ReservationRow, property: string): ReservationOut {
  return {
    id: r.id,
    airbnb_code: r.airbnb_code,
    source: r.source,
    guest_name: r.guest_name,
    property,
    check_in: r.check_in,
    check_out: r.check_out,
    guests: r.guests,
    amount: Number(r.amount ?? 0),
    status: r.status,
    notes: r.notes,
  }
}

export async function findReservationById(db: Db, id: string): Promise<ReservationRow | null> {
  const { data, error } = await db.from('reservations').select(FIELDS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ReservationRow | null) ?? null
}

export async function findReservationByCode(db: Db, code: string): Promise<ReservationRow | null> {
  const { data, error } = await db.from('reservations').select(FIELDS).eq('airbnb_code', code).limit(1)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ReservationRow[])[0] ?? null
}

/** Reservas no canceladas del apartamento que se cruzan con la estadía (sin contar la propia). */
export async function reservationConflicts(
  db: Db,
  propertyId: string,
  stay: Stay,
  excludeId?: string,
): Promise<ReservationRow[]> {
  let query = db.from('reservations').select(FIELDS)
    .eq('property_id', propertyId)
    .neq('status', 'cancelled')
    .lt('check_in', stay.check_out)
    .gt('check_out', stay.check_in)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ReservationRow[]
}

/** Inserta la reserva y sus tareas, como la sincronización (nada para una estadía ya terminada). */
export async function insertReservation(
  db: Db,
  row: Omit<ReservationRow, 'id'>,
  today: string,
): Promise<{ reservation: ReservationRow; tasks_created: number }> {
  const { data, error } = await db.from('reservations').insert(row).select(FIELDS).single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo crear la reserva.')
  const reservation = data as ReservationRow
  const tasks = missingTurnoverTasks([{ ...reservation, tasks: [] }], today)
  if (tasks.length > 0) {
    const { error: taskError } = await db.from('tasks').insert(tasks)
    // The sync's repair step re-creates missing tasks; the reservation itself must not be lost.
    if (taskError) {
      console.error('[gpt-api] no pude crear las tareas de la reserva', reservation.id, taskError.message)
      return { reservation, tasks_created: 0 }
    }
  }
  return { reservation, tasks_created: tasks.length }
}

async function moveTask(db: Db, taskId: string, date: string) {
  const { error } = await db.from('tasks').update({ scheduled_for: date }).eq('id', taskId)
  if (error) throw new Error(error.message)
}

/**
 * Actualiza la reserva y, si cambiaron las fechas, mueve sus tareas como la app: limpieza al día
 * de salida; preparación al día antes de la llegada (nunca al pasado, y no si el huésped ya
 * llegó). Crea las que falten de una estadía vigente confirmada.
 */
export async function updateReservationRow(
  db: Db,
  id: string,
  update: Partial<Omit<ReservationRow, 'id'>>,
  datesChanged: boolean,
  today: string,
): Promise<{ reservation: ReservationRow; tasks_moved: number; tasks_created: number }> {
  const { data, error } = await db.from('reservations').update(update).eq('id', id).select(FIELDS).single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo actualizar la reserva.')
  const reservation = data as ReservationRow
  if (!datesChanged) return { reservation, tasks_moved: 0, tasks_created: 0 }

  const { data: taskRows, error: taskError } = await db.from('tasks').select('id, type').eq('reservation_id', id)
  if (taskError) throw new Error(taskError.message)
  const tasks = (taskRows ?? []) as { id: string; type: string }[]

  let moved = 0
  for (const t of tasks) {
    if (t.type === 'cleaning') {
      await moveTask(db, t.id, cleaningTaskFor(reservation).scheduled_for)
      moved++
    } else if (t.type === 'preparation' && reservation.check_in >= today) {
      await moveTask(db, t.id, preparationTaskFor(reservation, today).scheduled_for)
      moved++
    }
  }

  const missing = reservation.status === 'confirmed'
    ? missingTurnoverTasks([{ ...reservation, tasks }], today)
    : []
  if (missing.length > 0) {
    const { error: insertError } = await db.from('tasks').insert(missing)
    if (insertError) throw new Error(insertError.message)
  }
  return { reservation, tasks_moved: moved, tasks_created: missing.length }
}

/** "Borrar" como la app: la reserva queda cancelada y se borran sus tareas. */
export async function cancelReservationRow(
  db: Db,
  id: string,
): Promise<{ reservation: ReservationRow; tasks_deleted: number }> {
  const { data, error } = await db.from('reservations').update({ status: 'cancelled' }).eq('id', id).select(FIELDS).single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo cancelar la reserva.')
  const { data: deleted, error: deleteError } = await db.from('tasks').delete().eq('reservation_id', id).select('id')
  if (deleteError) throw new Error(deleteError.message)
  return { reservation: data as ReservationRow, tasks_deleted: (deleted ?? []).length }
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/gpt-api/reservation-writes.test.ts && npx tsc --noEmit -p tsconfig.json` → PASS
- [ ] **Step 5: Commit** `feat(mcp): crear, mover y cancelar reservas con sus tareas`

---

### Task 3: Servicio, consulta con `id`/`amount`, herramientas e instrucciones

**Files:** Modify `lib/gpt-api/reservations.ts`, `lib/gpt-api/compare.ts`, `lib/gpt-api/service.ts`, `lib/mcp/tools.ts`, `lib/mcp/instructions.ts`, `__tests__/lib/mcp/tools.test.ts`

- [ ] **Step 1: Failing test** — in `__tests__/lib/mcp/tools.test.ts`:
  - type of `calls`: `{ name: string; config: { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } } }[]`
  - expected names: append `'create_reservation', 'update_reservation', 'cancel_reservation'`
  - new test:

```ts
  it('marks only cancelling a reservation as destructive', () => {
    expect(calls.filter(c => c.config.annotations?.destructiveHint).map(c => c.name)).toEqual(['cancel_reservation'])
  })
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/mcp/tools.test.ts` → FAIL

- [ ] **Step 3: `amount` in the reservations query**
  - `lib/gpt-api/reservations.ts`: `FIELDS` → `'id, airbnb_code, guest_name, property_id, check_in, check_out, guests, amount, status, source, notes'`
  - `lib/gpt-api/compare.ts` `AppReservation`: add `amount?: number | null` (after `guests`)
  - `lib/gpt-api/service.ts` `listReservationsTool` map: add `id: r.id,` first and `amount: Number(r.amount ?? 0),` after `guests`

- [ ] **Step 4: Service** — `lib/gpt-api/service.ts`: imports

```ts
import {
  appendReservationNote, cancelReservationRow, conflictMessage, creationNotes, findReservationByCode,
  findReservationById, insertReservation, reservationConflicts, toReservationOut, updateReservationRow,
  type ReservationRow,
} from './reservation-writes'
```

and add `checkStay, parseNewReservation, parseReservationId, parseReservationPatch` to the `./validate` import; then append:

<!-- file-append: lib/gpt-api/service.ts -->
```ts

function refreshReservations() {
  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  revalidatePath('/tasks')
}

const STATUS_ES: Record<string, string> = { confirmed: 'confirmada', blocked: 'bloqueo', cancelled: 'cancelada' }
const stayText = (r: { check_in: string; check_out: string }) => `${shortDate(r.check_in)} a ${shortDate(r.check_out)}`

/** Crea una reserva (directa o de Airbnb) con sus tareas; nunca duplica un código ni se cruza con otra. */
export async function createReservationTool(db: Db, body: unknown, today: string, createdBy = 'ChatGPT') {
  const input = parseNewReservation(body)
  if (!input.ok) return failed(400, input.error)
  const v = input.value
  const property = resolveProperty(v.property, await listProperties(db))
  if (!property) return unknownProperty(v.property)

  if (v.code) {
    const existing = await findReservationByCode(db, v.code)
    if (existing) {
      return failed(409, `Ya existe la reserva ${v.code} de ${existing.guest_name} (${stayText(existing)}, ${STATUS_ES[existing.status] ?? existing.status}); no creo otra. Para cambiarla usa update_reservation con id ${existing.id}.`)
    }
  }
  const conflicts = await reservationConflicts(db, property.id, v)
  if (conflicts.length > 0) return failed(409, conflictMessage(property.name, conflicts))

  const { reservation, tasks_created } = await insertReservation(db, {
    property_id: property.id,
    source: v.source,
    airbnb_code: v.code,
    guest_name: v.guest_name,
    check_in: v.check_in,
    check_out: v.check_out,
    guests: v.guests,
    amount: v.amount,
    notes: creationNotes(createdBy, today, v.note),
    status: 'confirmed',
  }, today)
  refreshReservations()
  return done({ reservation: toReservationOut(reservation, property.name), tasks_created }, 201)
}

/** Cambia huésped, huéspedes, fechas o monto, o agrega una nota; mueve las tareas si cambian las fechas. */
export async function updateReservationTool(db: Db, body: unknown, today: string) {
  const parsed = parseReservationPatch(body)
  if (!parsed.ok) return failed(400, parsed.error)
  const patch = parsed.value
  const current = await findReservationById(db, patch.id)
  if (!current) return failed(404, 'No existe esa reserva.')
  if (current.status === 'cancelled') {
    return failed(409, 'Esa reserva está cancelada; si hace falta, créala de nuevo con create_reservation.')
  }

  const stay = checkStay(patch.check_in ?? current.check_in, patch.check_out ?? current.check_out)
  if (!stay.ok) return failed(400, stay.error)
  const datesChanged = stay.value.check_in !== current.check_in || stay.value.check_out !== current.check_out
  const propertyName = (await listProperties(db)).find(p => p.id === current.property_id)?.name ?? '—'
  if (datesChanged) {
    const conflicts = await reservationConflicts(db, current.property_id, stay.value, current.id)
    if (conflicts.length > 0) return failed(409, conflictMessage(propertyName, conflicts))
  }

  const update: Partial<Omit<ReservationRow, 'id'>> = { ...stay.value }
  if (patch.guest_name !== undefined) update.guest_name = patch.guest_name
  if (patch.guests !== undefined) update.guests = patch.guests
  if (patch.amount !== undefined) update.amount = patch.amount
  if (patch.note) update.notes = appendReservationNote(current.notes, patch.note)

  const result = await updateReservationRow(db, current.id, update, datesChanged, today)
  refreshReservations()
  return done({
    reservation: toReservationOut(result.reservation, propertyName),
    previous: {
      guest_name: current.guest_name,
      check_in: current.check_in,
      check_out: current.check_out,
      guests: current.guests,
      amount: Number(current.amount ?? 0),
    },
    tasks_moved: result.tasks_moved,
    tasks_created: result.tasks_created,
  })
}

/** "Borrar" como la app: la reserva queda cancelada y se borran sus tareas. */
export async function cancelReservationTool(db: Db, body: unknown) {
  const id = parseReservationId(body)
  if (!id.ok) return failed(400, id.error)
  const current = await findReservationById(db, id.value)
  if (!current) return failed(404, 'No existe esa reserva.')
  const propertyName = (await listProperties(db)).find(p => p.id === current.property_id)?.name ?? '—'
  if (current.status === 'cancelled') {
    return done({ already_cancelled: true, reservation: toReservationOut(current, propertyName), tasks_deleted: 0 })
  }
  const { reservation, tasks_deleted } = await cancelReservationRow(db, current.id)
  refreshReservations()
  return done({ already_cancelled: false, reservation: toReservationOut(reservation, propertyName), tasks_deleted })
}
```

- [ ] **Step 5: Tools** — `lib/mcp/tools.ts`: import `cancelReservationTool, createReservationTool, updateReservationTool` from the service; header comment "las 6 del GPT, las horas de salida y llegada y las reservas"; append inside `registerTools`:

<!-- file-insert-tools: lib/mcp/tools.ts -->
```ts

  server.registerTool('create_reservation', {
    title: 'Crear reserva',
    description: 'Crea una reserva directa o de Airbnb con sus tareas de limpieza y preparación, como el formulario de la app. Airbnb exige el código HM…; no crea si el código ya existe ni si se cruza con otra reserva del apartamento.',
    inputSchema: z.object({
      property: z.string().describe('Nombre exacto del apartamento (list_properties)'),
      source: z.enum(['direct', 'airbnb']).describe('direct = reserva directa; airbnb = de Airbnb'),
      guest_name: z.string(),
      check_in: date,
      check_out: date,
      guests: z.number().int().optional(),
      amount: z.number().optional().describe('Monto total en pesos colombianos'),
      code: z.string().optional().describe('Código de confirmación HM… (obligatorio si source = airbnb)'),
      note: z.string().optional().describe('Nota que se agrega a la reserva'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, (body, ctx) => run(() =>
    createReservationTool(serviceDb(), body, todayInBogota(), memberFromAuth(ctx.http?.authInfo)?.name)))

  server.registerTool('update_reservation', {
    title: 'Modificar reserva',
    description: 'Cambia el huésped, el número de huéspedes, las fechas o el monto de una reserva, o le agrega una nota (no reemplaza las notas). Si cambian las fechas mueve sus tareas. No cambia el apartamento: para eso cancela y crea de nuevo.',
    inputSchema: z.object({
      id: z.string().describe('id de la reserva (de list_reservations o create_reservation)'),
      guest_name: z.string().optional(),
      guests: z.number().int().nullable().optional(),
      check_in: date.optional(),
      check_out: date.optional(),
      amount: z.number().optional().describe('Monto total en pesos colombianos'),
      note: z.string().optional().describe('Nota que se agrega al final'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, (body) => run(() => updateReservationTool(serviceDb(), body, todayInBogota())))

  server.registerTool('cancel_reservation', {
    title: 'Cancelar (borrar) reserva',
    description: 'Cancela una reserva como "Eliminar" en la app: queda cancelada y se borran sus tareas de limpieza y preparación. No la borra del todo, para que la sincronización de Gmail no la vuelva a importar.',
    inputSchema: z.object({
      id: z.string().describe('id de la reserva (de list_reservations)'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, (body) => run(() => cancelReservationTool(serviceDb(), body)))
```

- [ ] **Step 6: Instructions** — `lib/mcp/instructions.ts`: replace the compare line `- Nunca digas que corregiste reservas: solo se deja la nota "⚠️ Diferencia con Airbnb" en la reserva de la app.` with `- compare_reservations solo deja la nota "⚠️ Diferencia con Airbnb"; si piden corregir, usa update_reservation mostrando antes el cambio.` and insert before `REGLAS`:

```
RESERVAS
- Crear: create_reservation (directa o de Airbnb; las de Airbnb necesitan el código HM… y normalmente las trae la sincronización de Gmail, así que créalas a mano solo si lo piden).
- Modificar o cancelar: primero busca la reserva con list_reservations y usa su id con update_reservation o cancel_reservation.
- Antes de crear, modificar o cancelar, muestra el resumen (apartamento, huésped, fechas, huéspedes, monto) y espera el "sí".
- Cancelar no borra del todo: la reserva queda cancelada y se borran sus tareas.
- Para cambiar de apartamento: cancela y crea de nuevo.
```

- [ ] **Step 7: Check** `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx eslint lib app actions proxy.ts` → todo pasa
- [ ] **Step 8: Commit** `feat(mcp): herramientas para crear, modificar y cancelar reservas`

---

### Task 4: Verificación y entrega

- [ ] `npm run build`; lectura contra la base real (`list_reservations` con `id`/`amount`; `reservationConflicts` de una reserva real devuelve al menos a sí misma sin `excludeId`).
- [ ] PR con `info-softop`, chequeos en verde, merge, deploy verificado.
- [ ] ChatGPT: Ajustes → Complementos → AirAdmin → "Actualizar herramientas"; consulta de solo lectura.
