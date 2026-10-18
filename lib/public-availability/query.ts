/**
 * Validación de la consulta pública. Arrival y departure son obligatorios; guests es opcional.
 * Sin guests la búsqueda evalúa sólo fechas y reglas, sin criterio de capacidad.
 * Solo se aceptan arrival, departure y guests, una vez cada uno
 * y en formato exacto: cualquier otro parámetro (p. ej. un id de apartamento o de tenant) o un valor
 * repetido es ambiguo y se rechaza con 400. Las fechas son días de Colombia (America/Bogota).
 */
import { addDays, daysBetween, isIsoDate, todayInBogota } from '@/lib/gpt-api/dates'

export interface AvailabilityQuery {
  arrival: string
  departure: string
  guests?: number
}

export type QueryResult = { ok: true; query: AvailabilityQuery } | { ok: false; message: string }

const ALLOWED = new Set(['arrival', 'departure', 'guests'])
export const MAX_GUESTS = 8
/** Límites de abuso, no reglas de los apartamentos: una consulta más larga o lejana es inválida. */
export const MAX_NIGHTS = 365
export const MAX_DAYS_AHEAD = 730

export function parseAvailabilityQuery(params: URLSearchParams, now: Date): QueryResult {
  const keys = [...params.keys()]
  const unknown = keys.find(k => !ALLOWED.has(k))
  if (unknown !== undefined) return { ok: false, message: 'Solo se admiten los parámetros arrival, departure y guests.' }
  for (const k of ALLOWED) {
    const values = params.getAll(k)
    if (values.length === 0 && k !== 'guests') return { ok: false, message: `Falta el parámetro ${k}.` }
    if (values.length > 1) return { ok: false, message: `El parámetro ${k} está repetido.` }
  }

  const arrival = params.get('arrival')!
  const departure = params.get('departure')!
  const guestsRaw = params.get('guests')

  if (!isIsoDate(arrival)) return { ok: false, message: 'arrival debe ser una fecha real con formato YYYY-MM-DD.' }
  if (!isIsoDate(departure)) return { ok: false, message: 'departure debe ser una fecha real con formato YYYY-MM-DD.' }
  if (guestsRaw !== null && (!/^[1-9]\d*$/.test(guestsRaw) || Number(guestsRaw) > MAX_GUESTS)) {
    return { ok: false, message: `guests debe ser un entero entre 1 y ${MAX_GUESTS}.` }
  }

  const today = todayInBogota(now)
  if (arrival < today) return { ok: false, message: 'arrival no puede ser anterior a hoy (hora de Colombia).' }
  if (departure <= arrival) return { ok: false, message: 'departure debe ser posterior a arrival.' }
  if (daysBetween(arrival, departure) > MAX_NIGHTS) return { ok: false, message: `La estadía no puede superar ${MAX_NIGHTS} noches.` }
  if (arrival > addDays(today, MAX_DAYS_AHEAD)) return { ok: false, message: 'arrival está demasiado lejos en el futuro.' }

  return { ok: true, query: { arrival, departure, ...(guestsRaw !== null && { guests: Number(guestsRaw) }) } }
}
