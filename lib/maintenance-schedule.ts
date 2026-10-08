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
