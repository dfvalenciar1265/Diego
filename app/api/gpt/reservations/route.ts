/** GET /api/gpt/reservations — reservas de la app con noches en el rango. Nunca devuelve montos. */
import type { NextRequest } from 'next/server'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, withApiKey } from '@/lib/gpt-api/http'
import { listProperties, resolveProperty } from '@/lib/gpt-api/properties'
import { listReservations } from '@/lib/gpt-api/reservations'
import { parseRange } from '@/lib/gpt-api/validate'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    const range = parseRange(params.get('from'), params.get('to'), todayInBogota())
    if (!range.ok) return errorResponse(400, range.error)

    const db = serviceDb()
    const properties = await listProperties(db)
    const propertyName = params.get('property')
    let propertyId: string | undefined
    if (propertyName) {
      const property = resolveProperty(propertyName, properties)
      if (!property) {
        return errorResponse(404, `No reconozco el apartamento «${propertyName}». Consulta listProperties para ver los nombres.`)
      }
      propertyId = property.id
    }

    const rows = await listReservations(db, range.value, propertyId)
    const nameOf = new Map(properties.map(p => [p.id, p.name]))
    return jsonResponse({
      ...range.value,
      count: rows.length,
      reservations: rows.map(r => ({
        airbnb_code: r.airbnb_code,
        guest_name: r.guest_name,
        property: nameOf.get(r.property_id) ?? null,
        check_in: r.check_in,
        check_out: r.check_out,
        guests: r.guests,
        status: r.status,
        source: r.source,
        notes: r.notes,
      })),
    })
  })
}
