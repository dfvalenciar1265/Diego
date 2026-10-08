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
