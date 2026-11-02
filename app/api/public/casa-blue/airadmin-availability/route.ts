import { createClient } from '@supabase/supabase-js'
import { handleAvailability, handlePreflight } from '@/lib/public-availability/handler'
import { loadAirAdminSnapshot } from '@/lib/public-availability/airadmin-source'
import { RateLimiter } from '@/lib/public-availability/http'

const limiter = new RateLimiter()

export async function GET(req: Request) {
  return handleAvailability(req, {
    db: () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
    },
    now: () => new Date(), limiter, load: loadAirAdminSnapshot,
  })
}

export async function OPTIONS(req: Request) {
  return handlePreflight(req)
}
