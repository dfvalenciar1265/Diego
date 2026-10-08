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
