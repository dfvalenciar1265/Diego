/**
 * Disponibilidad pública para el sitio Casa Blue Cartagena (HTML estático).
 * Contrato y reglas: lib/public-availability/handler.ts y CASA-BLUE-API-HANDOFF.txt.
 */
import { createClient } from '@supabase/supabase-js'
import { handleAvailability, handlePreflight } from '@/lib/public-availability/handler'
import { RateLimiter } from '@/lib/public-availability/http'

const limiter = new RateLimiter()

function readDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  // Solo en el servidor; la consulta solo hace SELECT de columnas puntuales.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(req: Request) {
  return handleAvailability(req, { db: readDb, now: () => new Date(), limiter })
}

export async function OPTIONS(req: Request) {
  return handlePreflight(req)
}
