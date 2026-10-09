/**
 * /api/gpt/maintenance (GPT "AirAdmin")
 *  - GET  → pendientes, por apartamento y estado (por defecto abiertos + en progreso)
 *  - POST → crea un pendiente reportado por Diego, sin duplicar uno abierto con el mismo título
 */
import type { NextRequest } from 'next/server'
import { serviceDb } from '@/lib/gpt-api/db'
import { readJson, toResponse, withApiKey } from '@/lib/gpt-api/http'
import { createMaintenanceTool, listMaintenanceTool } from '@/lib/gpt-api/service'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const params = req.nextUrl.searchParams
    return toResponse(await listMaintenanceTool(serviceDb(), {
      property: params.get('property'),
      status: params.get('status'),
    }))
  })
}

export async function POST(req: NextRequest) {
  return withApiKey(req, async () => toResponse(await createMaintenanceTool(serviceDb(), await readJson(req))))
}
