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
