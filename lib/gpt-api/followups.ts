/**
 * Cobros adicionales y solicitudes especiales de una reserva (tablas reservation_charges y
 * special_requests, migración 20261019130000). Un cobro adicional vive aparte del precio de la
 * reserva y del desembolso de Airbnb: pendiente no es ingreso. Una solicitud separa registrada,
 * avisada y lista: avisar no es dejarla lista.
 *
 * Toda escritura dice quién y por dónde (updated_by/updated_via), y los cambios exigen la
 * `version` leída: si otro la cambió antes, no se pisa (conflicto) y se devuelve lo actual.
 * La base guarda el historial, impide borrar y marca para revisar cuando la reserva cambia.
 */
import { isIsoDate, todayInBogota } from './dates'
import type { Db } from './db'
import { isRecord, isUuid, LIMITS, oneOf, parseAmount, text, type Parsed } from './validate'

export const CHARGE_STATUSES = ['pending', 'collected', 'void'] as const
export const REQUEST_KINDS = ['crib', 'beds', 'other'] as const
export const REQUEST_STATUSES = ['registered', 'notified', 'ready', 'cancelled'] as const
export type ChargeStatus = (typeof CHARGE_STATUSES)[number]
export type RequestKind = (typeof REQUEST_KINDS)[number]
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
export type Via = 'app' | 'mcp'

export interface Actor {
  id: string
  via: Via
}

export interface ChargeRow {
  id: string
  reservation_id: string
  property_id: string
  concept: string
  amount: number
  currency: 'COP'
  due_date: string
  status: ChargeStatus
  collected_on: string | null
  confirmation: string | null
  void_reason: string | null
  notes: string
  review_reason: string | null
  version: number
  updated_at: string
}

export interface RequestRow {
  id: string
  reservation_id: string
  property_id: string
  kind: RequestKind
  description: string
  due_at: string
  responsible_id: string | null
  status: RequestStatus
  notified_at: string | null
  notified_note: string | null
  ready_at: string | null
  ready_by: string | null
  ready_confirmation: string | null
  cancel_reason: string | null
  review_reason: string | null
  version: number
  updated_at: string
}

const CHARGE_FIELDS = 'id, reservation_id, property_id, concept, amount, currency, due_date, status, collected_on, confirmation, void_reason, notes, review_reason, version, updated_at'
const REQUEST_FIELDS = 'id, reservation_id, property_id, kind, description, due_at, responsible_id, status, notified_at, notified_note, ready_at, ready_by, ready_confirmation, cancel_reason, review_reason, version, updated_at'

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

// ── Validación ────────────────────────────────────────────────────────────────

export interface NewChargeInput {
  reservation_id: string
  concept: string
  amount: number
  due_date: string | null   // null = el día de salida de la reserva
  notes: string
}

export interface ChargePatch {
  id: string
  expected_version: number
  status?: ChargeStatus
  collected_on?: string
  confirmation?: string
  void_reason?: string
  amount?: number
  concept?: string
  due_date?: string
  note?: string
  reviewed?: true
}

export interface NewRequestInput {
  reservation_id: string
  kind: RequestKind
  description: string
  due_at: string            // ISO con zona de Colombia (-05:00)
  responsible: string | null
}

export interface RequestPatch {
  id: string
  expected_version: number
  status?: Exclude<RequestStatus, 'registered'>
  notified_note?: string
  ready_confirmation?: string
  cancel_reason?: string
  responsible?: string
  reviewed?: true
}

const reservationIdError = '"reservation_id" debe ser el id de la reserva (de list_reservations).'

function parseVersion(v: unknown): Parsed<number> {
  return Number.isInteger(v) && (v as number) >= 1
    ? ok(v as number)
    : fail('Falta "expected_version": la versión que leíste con list_followups (evita pisar un cambio de otra persona).')
}

/** "2026-10-23" + "07:30" (hora de Colombia) → "2026-10-23T07:30:00-05:00". Colombia no cambia de hora. */
export function bogotaDateTime(date: string, time: string): string {
  return `${date}T${time}:00-05:00`
}

export function parseNewCharge(body: unknown): Parsed<NewChargeInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  if (typeof body.reservation_id !== 'string' || !isUuid(body.reservation_id)) return fail(reservationIdError)
  const concept = text(body.concept, 'concept', 160, true)
  if (!concept.ok) return concept
  if (concept.value.length < 2) return fail('"concept" es muy corto.')
  const amount = parseAmount(body.amount)
  if (!amount.ok) return amount
  if (amount.value <= 0) return fail('"amount" debe ser mayor que 0 (pesos colombianos).')
  if (body.due_date !== undefined && body.due_date !== null && !isIsoDate(body.due_date)) {
    return fail('"due_date" debe ser una fecha AAAA-MM-DD.')
  }
  const notes = text(body.notes, 'notes', LIMITS.text, false)
  if (!notes.ok) return notes
  return ok({
    reservation_id: body.reservation_id,
    concept: concept.value,
    amount: amount.value,
    due_date: (body.due_date as string | undefined) ?? null,
    notes: notes.value,
  })
}

export function parseChargePatch(body: unknown, today: string): Parsed<ChargePatch> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  if (typeof body.id !== 'string' || !isUuid(body.id)) return fail('"id" debe ser el id del cobro (de list_followups).')
  const version = parseVersion(body.expected_version)
  if (!version.ok) return version
  const patch: ChargePatch = { id: body.id, expected_version: version.value }

  if (body.status !== undefined) {
    if (!oneOf(body.status, CHARGE_STATUSES)) return fail('"status" debe ser pending, collected o void.')
    patch.status = body.status
  }
  if (patch.status === 'collected') {
    const confirmation = text(body.confirmation, 'confirmation', 300, true)
    if (!confirmation.ok) return fail('Para darlo por cobrado indica "confirmation": referencia, comprobante o cómo se confirmó el pago.')
    patch.confirmation = confirmation.value
    const on = body.collected_on ?? today
    if (!isIsoDate(on)) return fail('"collected_on" debe ser una fecha AAAA-MM-DD.')
    if (on > today) return fail('"collected_on" no puede ser una fecha futura: es la fecha real del cobro.')
    patch.collected_on = on
  }
  if (patch.status === 'void') {
    const reason = text(body.void_reason, 'void_reason', 300, true)
    if (!reason.ok) return fail('Para anular el cobro indica el motivo en "void_reason".')
    patch.void_reason = reason.value
  }
  if (body.amount !== undefined) {
    const amount = parseAmount(body.amount)
    if (!amount.ok) return amount
    if (amount.value <= 0) return fail('"amount" debe ser mayor que 0.')
    patch.amount = amount.value
  }
  if (body.concept !== undefined) {
    const concept = text(body.concept, 'concept', 160, true)
    if (!concept.ok) return concept
    patch.concept = concept.value
  }
  if (body.due_date !== undefined) {
    if (!isIsoDate(body.due_date)) return fail('"due_date" debe ser una fecha AAAA-MM-DD.')
    patch.due_date = body.due_date
  }
  if (body.note !== undefined) {
    const note = text(body.note, 'note', LIMITS.text, true)
    if (!note.ok) return note
    patch.note = note.value
  }
  if (body.reviewed === true) patch.reviewed = true
  if (Object.keys(patch).length === 2) {
    return fail('Envía al menos un cambio: status, amount, concept, due_date, note o reviewed.')
  }
  return ok(patch)
}

export function parseNewRequest(body: unknown): Parsed<NewRequestInput> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  if (typeof body.reservation_id !== 'string' || !isUuid(body.reservation_id)) return fail(reservationIdError)
  if (!oneOf(body.kind, REQUEST_KINDS)) return fail('"kind" debe ser crib (cuna), beds (preparación de camas) u other.')
  const description = text(body.description, 'description', 500, true)
  if (!description.ok) return description
  if (description.value.length < 2) return fail('"description" es muy corta.')
  if (!isIsoDate(body.due_date)) return fail('"due_date" debe ser la fecha límite AAAA-MM-DD.')
  const time = body.due_time ?? '09:00'
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return fail('"due_time" debe ser una hora HH:MM de Colombia (24 h).')
  }
  const responsible = text(body.responsible, 'responsible', LIMITS.name, false)
  if (!responsible.ok) return responsible
  return ok({
    reservation_id: body.reservation_id,
    kind: body.kind,
    description: description.value,
    due_at: bogotaDateTime(body.due_date, time),
    responsible: responsible.value || null,
  })
}

export function parseRequestPatch(body: unknown): Parsed<RequestPatch> {
  if (!isRecord(body)) return fail('El cuerpo debe ser un objeto JSON.')
  if (typeof body.id !== 'string' || !isUuid(body.id)) return fail('"id" debe ser el id de la solicitud (de list_followups).')
  const version = parseVersion(body.expected_version)
  if (!version.ok) return version
  const patch: RequestPatch = { id: body.id, expected_version: version.value }

  if (body.status !== undefined) {
    if (!oneOf(body.status, ['notified', 'ready', 'cancelled'] as const)) {
      return fail('"status" debe ser notified (se avisó), ready (quedó lista y confirmada) o cancelled.')
    }
    patch.status = body.status
  }
  if (patch.status === 'notified') {
    const note = text(body.notified_note, 'notified_note', 300, true)
    if (!note.ok) return fail('Indica en "notified_note" a quién se avisó y por dónde.')
    patch.notified_note = note.value
  }
  if (patch.status === 'ready') {
    const confirmation = text(body.ready_confirmation, 'ready_confirmation', 300, true)
    if (!confirmation.ok) {
      return fail('Para darla por lista indica en "ready_confirmation" quién confirmó que quedó hecha (avisar no basta).')
    }
    patch.ready_confirmation = confirmation.value
  }
  if (patch.status === 'cancelled') {
    const reason = text(body.cancel_reason, 'cancel_reason', 300, true)
    if (!reason.ok) return fail('Para cancelar la solicitud indica el motivo en "cancel_reason".')
    patch.cancel_reason = reason.value
  }
  if (body.responsible !== undefined) {
    const responsible = text(body.responsible, 'responsible', LIMITS.name, true)
    if (!responsible.ok) return responsible
    patch.responsible = responsible.value
  }
  if (body.reviewed === true) patch.reviewed = true
  if (Object.keys(patch).length === 2) return fail('Envía al menos un cambio: status, responsible o reviewed.')
  return ok(patch)
}

// ── Base de datos ─────────────────────────────────────────────────────────────

export type WriteOutcome<T> =
  | { kind: 'ok'; row: T }
  | { kind: 'not_found' }
  | { kind: 'conflict'; current: T }
  | { kind: 'rejected'; message: string }

const PG_UNIQUE = '23505'
const PG_CHECK = '23514'

/** Mensaje en español para una regla de la base (estado final, borrar, permisos). */
function ruleMessage(message: string): string {
  if (message.includes('AIRADMIN_FINAL')) return 'Ya está en estado final (cobrado/anulado o lista/cancelada): no se puede cambiar.'
  if (message.includes('collected_needs_proof')) return 'Para darlo por cobrado hacen falta la fecha real y la confirmación.'
  if (message.includes('ready_needs_proof')) return 'Para darla por lista hace falta quién la confirmó y la confirmación.'
  return 'La base rechazó el cambio por una regla de integridad.'
}

export async function chargesFor(db: Db, reservationIds: string[]): Promise<ChargeRow[]> {
  if (reservationIds.length === 0) return []
  const { data, error } = await db.from('reservation_charges').select(CHARGE_FIELDS)
    .in('reservation_id', reservationIds).order('due_date')
  if (error) throw new Error(error.message)
  return (data ?? []) as ChargeRow[]
}

/** Cobros pendientes que vencen ese día (de cualquier reserva no cancelada). */
export async function pendingChargesDue(db: Db, date: string): Promise<ChargeRow[]> {
  const { data, error } = await db.from('reservation_charges').select(CHARGE_FIELDS)
    .eq('status', 'pending').eq('due_date', date)
  if (error) throw new Error(error.message)
  return (data ?? []) as ChargeRow[]
}

export async function requestsFor(db: Db, reservationIds: string[]): Promise<RequestRow[]> {
  if (reservationIds.length === 0) return []
  const { data, error } = await db.from('special_requests').select(REQUEST_FIELDS)
    .in('reservation_id', reservationIds).order('due_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as RequestRow[]
}

export async function findCharge(db: Db, id: string): Promise<ChargeRow | null> {
  const { data, error } = await db.from('reservation_charges').select(CHARGE_FIELDS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ChargeRow | null) ?? null
}

export async function findRequest(db: Db, id: string): Promise<RequestRow | null> {
  const { data, error } = await db.from('special_requests').select(REQUEST_FIELDS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as RequestRow | null) ?? null
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** El cobro abierto que ya cubre ese concepto y fecha en la reserva (mismo criterio que el índice único). */
export function duplicateCharge(rows: ChargeRow[], c: { reservation_id: string; concept: string; due_date: string }) {
  return rows.find(r => r.reservation_id === c.reservation_id && r.status !== 'void'
    && r.due_date === c.due_date && sameText(r.concept, c.concept)) ?? null
}

export function duplicateRequest(rows: RequestRow[], q: { reservation_id: string; kind: RequestKind; description: string }) {
  return rows.find(r => r.reservation_id === q.reservation_id && r.status !== 'cancelled' && r.kind === q.kind
    && (q.kind !== 'other' || sameText(r.description, q.description))) ?? null
}

/** Crea el cobro o devuelve el que ya existe (created=false): repetir la llamada no duplica. */
export async function createCharge(
  db: Db, input: NewChargeInput & { due_date: string; property_id: string }, actor: Actor,
): Promise<{ created: boolean; charge: ChargeRow }> {
  const existing = duplicateCharge(await chargesFor(db, [input.reservation_id]), input)
  if (existing) return { created: false, charge: existing }
  const { data, error } = await db.from('reservation_charges').insert({
    reservation_id: input.reservation_id,
    property_id: input.property_id, // la base lo vuelve a tomar de la reserva
    concept: input.concept,
    amount: input.amount,
    due_date: input.due_date,
    notes: input.notes,
    created_by: actor.id,
    updated_by: actor.id,
    updated_via: actor.via,
  }).select(CHARGE_FIELDS).single()
  if (error?.code === PG_UNIQUE) {
    // Otra llamada igual ganó la carrera: devolver la suya.
    const winner = duplicateCharge(await chargesFor(db, [input.reservation_id]), input)
    if (winner) return { created: false, charge: winner }
  }
  if (error) throw new Error(error.message)
  return { created: true, charge: data as ChargeRow }
}

export async function createRequest(
  db: Db, input: Omit<NewRequestInput, 'responsible'> & { responsible_id: string | null; property_id: string }, actor: Actor,
): Promise<{ created: boolean; request: RequestRow }> {
  const existing = duplicateRequest(await requestsFor(db, [input.reservation_id]), input)
  if (existing) return { created: false, request: existing }
  const { data, error } = await db.from('special_requests').insert({
    reservation_id: input.reservation_id,
    property_id: input.property_id, // la base lo vuelve a tomar de la reserva
    kind: input.kind,
    description: input.description,
    due_at: input.due_at,
    responsible_id: input.responsible_id,
    created_by: actor.id,
    updated_by: actor.id,
    updated_via: actor.via,
  }).select(REQUEST_FIELDS).single()
  if (error?.code === PG_UNIQUE) {
    const winner = duplicateRequest(await requestsFor(db, [input.reservation_id]), input)
    if (winner) return { created: false, request: winner }
  }
  if (error) throw new Error(error.message)
  return { created: true, request: data as RequestRow }
}

/** Actualiza solo si nadie la cambió desde `expected_version`; si no, devuelve lo actual. */
async function guardedUpdate<T extends { version: number }>(
  db: Db, table: 'reservation_charges' | 'special_requests', fields: string,
  id: string, expectedVersion: number, update: Record<string, unknown>,
  find: (db: Db, id: string) => Promise<T | null>,
): Promise<WriteOutcome<T>> {
  const { data, error } = await db.from(table).update(update)
    .eq('id', id).eq('version', expectedVersion).select(fields)
  if (error?.code === PG_CHECK || error?.code === PG_UNIQUE) return { kind: 'rejected', message: ruleMessage(error.message) }
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as T[]
  if (rows.length === 1) return { kind: 'ok', row: rows[0] }
  const current = await find(db, id)
  return current ? { kind: 'conflict', current } : { kind: 'not_found' }
}

/** Agrega una línea "[19-oct] …" a las notas del cobro, sin borrar lo que había. */
export function appendFollowupNote(notes: string, note: string, today: string): string {
  const [, m, d] = today.split('-').map(Number)
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const line = `[${d}-${months[m - 1]}] ${note}`
  return notes ? `${notes}\n${line}` : line
}

export async function updateCharge(
  db: Db, patch: ChargePatch, current: ChargeRow, actor: Actor, today: string,
): Promise<WriteOutcome<ChargeRow>> {
  const update: Record<string, unknown> = { updated_by: actor.id, updated_via: actor.via }
  if (patch.status) update.status = patch.status
  if (patch.status === 'collected') {
    update.collected_on = patch.collected_on
    update.confirmation = patch.confirmation
  }
  if (patch.status === 'void') update.void_reason = patch.void_reason
  if (patch.amount !== undefined) update.amount = patch.amount
  if (patch.concept !== undefined) update.concept = patch.concept
  if (patch.due_date !== undefined) update.due_date = patch.due_date
  if (patch.note) update.notes = appendFollowupNote(current.notes, patch.note, today)
  if (patch.reviewed) update.review_reason = null
  return guardedUpdate(db, 'reservation_charges', CHARGE_FIELDS, patch.id, patch.expected_version, update, findCharge)
}

export async function updateRequest(
  db: Db, patch: RequestPatch & { responsible_id?: string }, actor: Actor, now: Date = new Date(),
): Promise<WriteOutcome<RequestRow>> {
  const update: Record<string, unknown> = { updated_by: actor.id, updated_via: actor.via }
  if (patch.status) update.status = patch.status
  if (patch.status === 'notified') {
    update.notified_at = now.toISOString()
    update.notified_note = patch.notified_note
  }
  if (patch.status === 'ready') {
    update.ready_at = now.toISOString()
    update.ready_by = actor.id
    update.ready_confirmation = patch.ready_confirmation
  }
  if (patch.status === 'cancelled') update.cancel_reason = patch.cancel_reason
  if (patch.responsible_id) update.responsible_id = patch.responsible_id
  if (patch.reviewed) update.review_reason = null
  return guardedUpdate(db, 'special_requests', REQUEST_FIELDS, patch.id, patch.expected_version, update, findRequest)
}

/** ¿Vence una solicitud abierta antes de la llegada? Se usa para avisar en la preparación. */
export function requestIsLate(r: Pick<RequestRow, 'status' | 'due_at'>, now: Date = new Date()): boolean {
  return (r.status === 'registered' || r.status === 'notified') && Date.parse(r.due_at) < now.getTime()
}

/** Día (en Colombia) de una fecha y hora ISO. */
export function bogotaDay(iso: string): string {
  return todayInBogota(new Date(iso))
}
