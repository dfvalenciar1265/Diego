/** GET /api/gpt/openapi.json — esquema público para importar en el GPT (no lleva secretos). */
import { NextResponse, type NextRequest } from 'next/server'
import { buildOpenApi } from '@/lib/gpt-api/openapi'

export function GET(req: NextRequest) {
  return NextResponse.json(buildOpenApi(req.nextUrl.origin))
}
