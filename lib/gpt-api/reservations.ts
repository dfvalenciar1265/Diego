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
