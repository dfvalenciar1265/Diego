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
