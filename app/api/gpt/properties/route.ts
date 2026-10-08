/** GET /api/gpt/properties — apartamentos activos con su nombre exacto (GPT "AirAdmin"). */
import type { NextRequest } from 'next/server'
import { serviceDb } from '@/lib/gpt-api/db'
import { jsonResponse, withApiKey } from '@/lib/gpt-api/http'
import { listProperties } from '@/lib/gpt-api/properties'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => {
    const properties = await listProperties(serviceDb(), { onlyActive: true })
    return jsonResponse({ properties })
  })
}
