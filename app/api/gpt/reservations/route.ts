/** GET /api/gpt/reservations — reservas de la app con noches en el rango. Nunca devuelve montos. */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { toResponse, withApiKey } from '@/lib/gpt-api/http'
import { listReservationsTool } from '@/lib/gpt-api/service'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    return toResponse(await listReservationsTool(serviceDb(), {
      from: params.get('from'),
      to: params.get('to'),
      property: params.get('property'),
    }, todayInBogota()))
  })
}
