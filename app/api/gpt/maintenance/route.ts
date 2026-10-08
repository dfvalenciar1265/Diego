/**
 * /api/gpt/maintenance (GPT "AirAdmin")
 *  - GET  → pendientes, por apartamento y estado (por defecto abiertos + en progreso)
 *  - POST → crea un pendiente reportado por Diego, sin duplicar uno abierto con el mismo título
 */
import type { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { serviceDb } from '@/lib/gpt-api/db'
import { errorResponse, jsonResponse, readJson, withApiKey } from '@/lib/gpt-api/http'
import { createMaintenance, listMaintenance } from '@/lib/gpt-api/maintenance'
import { listProperties, resolveProperty } from '@/lib/gpt-api/properties'
import { parseMaintenanceFilter, parseNewMaintenance } from '@/lib/gpt-api/validate'

const unknownProperty = (name: string) =>
  errorResponse(404, `No reconozco el apartamento «${name}». Consulta listProperties para ver los nombres.`)

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    const status = parseMaintenanceFilter(params.get('status'))
    if (!status.ok) return errorResponse(400, status.error)

    const db = serviceDb()
    const propertyName = params.get('property')
    let propertyId: string | undefined
    if (propertyName) {
      const property = resolveProperty(propertyName, await listProperties(db))
      if (!property) return unknownProperty(propertyName)
      propertyId = property.id
    }

    const issues = await listMaintenance(db, { propertyId, status: status.value })
    return jsonResponse({ count: issues.length, issues })
  })
}

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => {
    const input = parseNewMaintenance(await readJson(req))
    if (!input.ok) return errorResponse(400, input.error)

    const db = serviceDb()
    const property = resolveProperty(input.value.property, await listProperties(db))
    if (!property) return unknownProperty(input.value.property)

    const result = await createMaintenance(db, {
      propertyId: property.id,
      title: input.value.title,
      description: input.value.description,
      priority: input.value.priority,
    })
    if (result.created) {
      revalidatePath('/maintenance')
      revalidatePath('/')
    }
    return jsonResponse(result, result.created ? 201 : 200)
  })
}
