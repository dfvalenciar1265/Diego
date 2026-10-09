/** GET /api/gpt/properties — apartamentos activos con su nombre exacto (GPT "AirAdmin"). */
import type { NextRequest } from 'next/server'
import { serviceDb } from '@/lib/gpt-api/db'
import { toResponse, withApiKey } from '@/lib/gpt-api/http'
import { propertiesTool } from '@/lib/gpt-api/service'

export async function GET(req: NextRequest) {
  return withApiKey(req, async () => toResponse(await propertiesTool(serviceDb())))
}
