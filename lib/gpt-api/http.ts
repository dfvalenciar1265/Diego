import { NextResponse, type NextRequest } from 'next/server'
import { checkApiKey } from './auth'

export const jsonResponse = (data: unknown, status = 200) => NextResponse.json(data, { status })
export const errorResponse = (status: number, error: string) => NextResponse.json({ error }, { status })

/**
 * Corre el handler solo si la petición trae la clave del API. Un error inesperado sale como 500
 * con un mensaje en español; el detalle queda en los registros de Vercel.
 */
export async function withApiKey(req: NextRequest, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  const auth = checkApiKey(req.headers.get('authorization'), process.env.GPT_API_KEY)
  if (!auth.ok) return errorResponse(auth.status, auth.error)
  try {
    return await handler()
  } catch (err) {
    console.error('[gpt-api]', err instanceof Error ? err.message : err)
    return errorResponse(500, 'Error interno del servidor. El detalle quedó en los registros de Vercel.')
  }
}

/** Cuerpo JSON de la petición, o undefined si no es JSON válido (lo rechaza la validación). */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}
